import { useEffect, useState } from 'react'
import type { Repo } from '../../store/types'
import { countRepoWorktrees, pruneStaleWorktrees } from '../../api/worktrees'
import { useT } from '../../utils/i18n'
import styles from './RepoTable.module.css'

export default function RepoRow({ repo, onUpdate, onRemove }: { repo: Repo; onUpdate(patch: Partial<{ name: string; path: string; base: string; description: string }>): void; onRemove(): void }) {
	const t = useT()
	const [wtCount, setWtCount] = useState<number | null>(null)
	// stale = 원격에서 머지·삭제된(gone) 워크트리. cleanable(미커밋 없음)만 자동 정리, dirty는 검토 대기로 노출.
	const [stale, setStale] = useState<{ cleanable: number; dirty: number } | null>(null)
	const [busy, setBusy] = useState(false)

	const refreshCount = () => {
		countRepoWorktrees(repo.id)
			.then((r) => setWtCount(r.count))
			.catch(() => setWtCount(null))
	}

	useEffect(() => {
		let cancelled = false
		countRepoWorktrees(repo.id)
			.then((r) => { if (!cancelled) setWtCount(r.count) })
			.catch(() => { if (!cancelled) setWtCount(null) })
		// 정리 후보 미리보기(dryRun) — 삭제 없이 gone 워크트리 개수만. 배지로 노출.
		pruneStaleWorktrees(repo.id, { dryRun: true })
			.then((r) => { if (!cancelled) setStale({ cleanable: r.targets.length, dirty: r.skippedDirty.length }) })
			.catch(() => { if (!cancelled) setStale(null) })
		return () => {
			cancelled = true
		}
	}, [repo.id, repo.path])

	const runPrune = () => {
		if (busy || !stale || stale.cleanable === 0) return
		setBusy(true)
		pruneStaleWorktrees(repo.id, { dryRun: false, includeDirty: false })
			.then((r) => {
				setStale({ cleanable: 0, dirty: r.skippedDirty.length })
				refreshCount()
			})
			.catch(() => {})
			.finally(() => setBusy(false))
	}

	const cleanable = stale?.cleanable ?? 0
	const dirty = stale?.dirty ?? 0

	return (
		<div className={styles.row}>
			<input className="fin m" value={repo.name} placeholder={t('백엔드')} onChange={(e) => onUpdate({ name: e.target.value })} />
			<input className="fin m" value={repo.path} placeholder="~/projects/service-backend" onChange={(e) => onUpdate({ path: e.target.value })} />
			<input className="fin m" value={repo.base ?? ''} placeholder="dev" onChange={(e) => onUpdate({ base: e.target.value })} />
			<input className="fin m" value={repo.description} placeholder={t('예: JSP 관리자 페이지, 백엔드 API')} onChange={(e) => onUpdate({ description: e.target.value })} />
			<span className={styles.wtCell}>
				<span className={styles.wtCount}>{wtCount === null ? '—' : wtCount}</span>
				{cleanable > 0 && (
					<button
						type="button"
						className={styles.pruneBtn}
						disabled={busy}
						onClick={runPrune}
						title={t('머지·삭제된 브랜치의 워크트리 {n}개를 정리합니다 (미커밋 변경 없는 것만)').replace('{n}', String(cleanable))}
					>
						🧹 {busy ? '…' : cleanable}
					</button>
				)}
				{dirty > 0 && (
					<span
						className={styles.staleDirty}
						title={t('머지됐지만 미커밋 변경이 남아 있어 자동 정리에서 제외된 워크트리 {n}개 — 직접 확인 후 정리하세요').replace('{n}', String(dirty))}
					>
						⚠️ {dirty}
					</span>
				)}
			</span>
			<span className={styles.removeBtn} title={t('삭제')} onClick={onRemove}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
					<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</span>
		</div>
	)
}
