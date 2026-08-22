import { useUiStore, applyTheme } from '../../store/useUiStore'
import type { Theme, Lang } from '../../store/useUiStore'
import { useTabsStore, MODEL_POLICY_NODE_ID } from '../../store/useTabsStore'
import Modal from '../common/Modal'
import styles from './SettingsModal.module.css'

const THEME_OPTS: { id: Theme; label: string }[] = [
	{ id: 'light', label: '라이트' },
	{ id: 'dark', label: '다크' },
	{ id: 'system', label: '시스템' },
]
const LANG_OPTS: { id: Lang; label: string }[] = [
	{ id: 'ko', label: '한글' },
	{ id: 'en', label: 'EN' },
]

export default function SettingsModal({ open, onClose }: { open: boolean; onClose(): void }) {
	const theme = useUiStore((s) => s.theme)
	const setTheme = useUiStore((s) => s.setTheme)
	const lang = useUiStore((s) => s.lang)
	const setLang = useUiStore((s) => s.setLang)

	function openModelPolicy() {
		const s = useTabsStore.getState()
		if (!s.tabsByNode[MODEL_POLICY_NODE_ID]?.length) s.openTab(MODEL_POLICY_NODE_ID, 'modelPolicy')
		s.setActiveNode(MODEL_POLICY_NODE_ID, 'modelPolicy')
		onClose()
	}

	return (
		<Modal open={open} onClose={onClose} width={380}>
			<div className={styles.head}>
				<span>설정</span>
				<span className={styles.close} onClick={onClose}>
					×
				</span>
			</div>
			<div className={styles.body}>
				<div className={styles.row}>
					<div>
						<div className={styles.rowLabel}>테마</div>
						<div className={styles.rowHint}>라이트/다크 화면을 선택합니다. 시스템은 OS 설정을 따라갑니다.</div>
					</div>
					<div className={styles.toggle}>
						{THEME_OPTS.map((o) => (
							<button
								key={o.id}
								type="button"
								className={`${styles.opt} ${theme === o.id ? styles.optActive : ''}`}
								onClick={() => {
									setTheme(o.id)
									applyTheme(o.id)
								}}
							>
								{o.label}
							</button>
						))}
					</div>
				</div>
				<div className={styles.row} style={{ marginTop: 16 }}>
					<div>
						<div className={styles.rowLabel}>내부 용어 언어</div>
						<div className={styles.rowHint}>오케스트레이터·워크트리 같은 짧은 용어 라벨만 바뀝니다.</div>
					</div>
					<div className={styles.toggle}>
						{LANG_OPTS.map((o) => (
							<button key={o.id} type="button" className={`${styles.opt} ${lang === o.id ? styles.optActive : ''}`} onClick={() => setLang(o.id)}>
								{o.label}
							</button>
						))}
					</div>
				</div>
				<div className={styles.row} style={{ marginTop: 16, cursor: 'pointer' }} onClick={openModelPolicy}>
					<div>
						<div className={styles.rowLabel}>모델 배정 →</div>
						<div className={styles.rowHint}>작업 종류별로 어떤 모델을 쓸지 탭에서 확인하고 바꿉니다.</div>
					</div>
				</div>
			</div>
		</Modal>
	)
}
