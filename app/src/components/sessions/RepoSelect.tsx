import { useEffect, useState } from 'react'
import { getRepoColor } from '../../utils/repoColor'
import type { Repo } from '../../store/types'
import styles from './TaskDetailModal.module.css'

// "이건 디자인된 드롭다운이었으면 하고 레포 색상은 내부에 있어야해" — 네이티브 <select>는 이 앱의
// 다른 곳(사이드바 레포 피커, SessionShell.tsx의 .repoSelect/.repoSelectPanel)에서 이미 쓰는 커스텀
// 드롭다운과 스타일이 다르다. TaskDetailContent 전용이었던 걸 여기로 뽑아 TeamRulesPane 등 다른
// 화면에서도 재사용한다 — 트리거 버튼 안에 선택된 레포의 색점을 넣고, 패널의 각 옵션 행에도 같은
// 색점을 붙인다. allowNone=false면 "(선택 안 함)" 옵션 자체를 없앤다(팀 규칙처럼 항상 레포 하나를
// 골라야 하는 화면용 — 태스크 레포 배정처럼 미배정이 유효한 화면은 기본값 그대로 둔다).
export default function RepoSelect({ repos, valueId, onChange, allowNone = true }: { repos: Repo[]; valueId: string | null; onChange(id: string | null): void; allowNone?: boolean }) {
	const [open, setOpen] = useState(false)
	const selected = repos.find((r) => r.id === valueId) ?? null

	useEffect(() => {
		if (!open) return
		const onDocClick = () => setOpen(false)
		document.addEventListener('click', onDocClick)
		return () => document.removeEventListener('click', onDocClick)
	}, [open])

	return (
		<span className={styles.repoSelect} onClick={(e) => e.stopPropagation()}>
			<button type="button" className={styles.repoSelectBtn} onClick={() => setOpen((o) => !o)}>
				<span
					className={styles.repoDot}
					style={{
						background: selected ? getRepoColor(selected) : 'var(--line2)',
					}}
				/>
				<span className={styles.repoSelectLabel}>{selected ? selected.name : '(선택 안 함)'}</span>
				<span className={`${styles.repoSelectChev} ${open ? styles.repoSelectChevOpen : ''}`}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
						<path d="M6 9l6 6 6-6" />
					</svg>
				</span>
			</button>
			{open && (
				<div className={styles.repoSelectPanel}>
					{allowNone && (
						<div
							className={`${styles.repoSelectOpt} ${!valueId ? styles.repoSelectOptSelected : ''}`}
							onClick={() => {
								onChange(null)
								setOpen(false)
							}}
						>
							(선택 안 함)
						</div>
					)}
					{repos.map((r) => (
						<div
							key={r.id}
							className={`${styles.repoSelectOpt} ${valueId === r.id ? styles.repoSelectOptSelected : ''}`}
							onClick={() => {
								onChange(r.id)
								setOpen(false)
							}}
						>
							<span className={styles.repoDot} style={{ background: getRepoColor(r) }} />
							<span className={styles.repoSelectOptName}>{r.name}</span>
						</div>
					))}
				</div>
			)}
		</span>
	)
}
