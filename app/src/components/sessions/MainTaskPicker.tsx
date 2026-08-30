import { useEffect, useState } from 'react'
import { useT } from '../../utils/i18n'
import styles from './TaskDetailModal.module.css'

// "메인 태스크를 고르는 기능도 필요해" — RepoSelect와 같은 드롭다운 패턴을 재사용한다. TaskDetailModal
// (독립 태스크 → 기존 메인 태스크로 편입, 기존 태스크 → 서브태스크로 선택)뿐 아니라 NewTaskModal(생성
// 시점에 메인/서브 결정)에서도 써서 별도 파일로 뺐다 — 스타일은 TaskDetailModal.module.css를 그대로 쓴다.
export default function MainTaskPicker({
	label,
	candidates,
	onPick,
	onCreateNew,
}: {
	label?: string
	candidates: { id: string; name: string }[]
	onPick(id: string): void
	onCreateNew?: (name: string) => Promise<string | null>
}) {
	const t = useT()
	const resolvedLabel = label ?? t('메인 태스크로 편입…')
	const [open, setOpen] = useState(false)
	// "메인태스크 만들기 동작안한다" — Electron 렌더러는 window.prompt()를 지원 안 해서(confirm()과
	// 달리 조용히 null만 돌려줌) 인라인 입력으로 바꿨다.
	const [creating, setCreating] = useState(false)
	const [draft, setDraft] = useState('')
	useEffect(() => {
		if (!open) return
		const onDocClick = () => {
			setOpen(false)
			setCreating(false)
		}
		document.addEventListener('click', onDocClick)
		return () => document.removeEventListener('click', onDocClick)
	}, [open])
	async function submitCreate() {
		const name = draft.trim()
		if (!name || !onCreateNew) return
		const id = await onCreateNew(name)
		if (id) onPick(id)
		setOpen(false)
		setCreating(false)
		setDraft('')
	}
	return (
		<span className={styles.repoSelect} onClick={(e) => e.stopPropagation()}>
			<button type="button" className={styles.repoSelectBtn} onClick={() => setOpen((o) => !o)}>
				<span className={styles.repoSelectLabel}>{resolvedLabel}</span>
				<span className={`${styles.repoSelectChev} ${open ? styles.repoSelectChevOpen : ''}`}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
						<path d="M6 9l6 6 6-6" />
					</svg>
				</span>
			</button>
			{open && (
				<div className={styles.repoSelectPanel}>
					{candidates.length === 0 && <div className={styles.repoSelectOpt}>{t('고를 수 있는 태스크가 아직 없습니다')}</div>}
					{candidates.map((c) => (
						<div
							key={c.id}
							className={styles.repoSelectOpt}
							onClick={() => {
								onPick(c.id)
								setOpen(false)
							}}
						>
							<span className={styles.repoSelectOptName}>{c.name}</span>
						</div>
					))}
					{/* "여기 option 가장 아래에 추가 버튼이 있으면 좋을듯" — 원하는 메인 태스크가 목록에 없으면
					    여기서 바로 새로 만들어 곧장 그걸로 편입한다. */}
					{onCreateNew &&
						(creating ? (
							<div className={styles.repoSelectOptNew} onClick={(e) => e.stopPropagation()}>
								<input
									autoFocus
									className={styles.repoSelectNewInput}
									value={draft}
									placeholder={t('새 메인 태스크 이름')}
									onChange={(e) => setDraft(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') submitCreate()
										if (e.key === 'Escape') setCreating(false)
									}}
								/>
								<button type="button" className={styles.repoSelectNewSubmit} disabled={!draft.trim()} onClick={submitCreate}>
									{t('추가')}
								</button>
							</div>
						) : (
							<div
								className={`${styles.repoSelectOpt} ${styles.repoSelectOptNew}`}
								onClick={(e) => {
									e.stopPropagation()
									setCreating(true)
								}}
							>
								+ {t('새 메인 태스크 만들기')}
							</div>
						))}
				</div>
			)}
		</span>
	)
}
