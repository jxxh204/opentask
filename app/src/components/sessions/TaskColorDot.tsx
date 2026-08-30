import { useState } from 'react'
import Modal from '../common/Modal'
import { REPO_COLOR_PALETTE } from '../../utils/repoColor'
import { useT } from '../../utils/i18n'
import styles from './TaskColorDot.module.css'

// "월캘린더에서 임의로 색상 바꾸는 거 추가하고싶어... 태스크하나를 색하나로 보여주는거야" — 레포
// 색상 피커(SessionShell.tsx RepoColorDot)와 같은 팝업 팔레트 패턴. null이면 캘린더가 기본 배경을
// 쓴다("적용 안 함" 옵션도 팔레트 맨 앞에 둔다). TaskDetailModal뿐 아니라 사이드바(FolderCard/TaskRow)
// 에서도 곧바로 색을 바꿀 수 있어야 해서 공용 컴포넌트로 뺐다.
export default function TaskColorDot({ color, onPick }: { color: string | null; onPick(color: string | null): void }) {
	const t = useT()
	const [open, setOpen] = useState(false)
	return (
		<>
			<span
				className={styles.dot}
				style={{ background: color || 'var(--bg)' }}
				title={t('태스크 색상')}
				onClick={(e) => {
					e.stopPropagation()
					setOpen(true)
				}}
			/>
			<Modal open={open} onClose={() => setOpen(false)} width={220}>
				<div className={styles.modalTitle}>{t('태스크 색상')}</div>
				<div className={styles.grid}>
					<span
						className={`${styles.swatch} ${styles.swatchNone} ${!color ? styles.swatchActive : ''}`}
						title={t('기본 배경')}
						onClick={() => {
							onPick(null)
							setOpen(false)
						}}
					>
						×
					</span>
					{REPO_COLOR_PALETTE.map((c) => (
						<span
							key={c}
							className={`${styles.swatch} ${c === color ? styles.swatchActive : ''}`}
							style={{ background: c }}
							onClick={() => {
								onPick(c)
								setOpen(false)
							}}
						/>
					))}
				</div>
			</Modal>
		</>
	)
}
