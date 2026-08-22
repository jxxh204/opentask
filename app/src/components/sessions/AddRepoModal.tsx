import { useState } from 'react'
import { useSessionsStore } from '../../store/useSessionsStore'
import Modal from '../common/Modal'
import FolderBrowserModal from '../common/FolderBrowserModal'
import styles from './AddRepoModal.module.css'

const FOLDER_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
	</svg>
)
const GLOBE_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<circle cx="12" cy="12" r="9" />
		<path d="M3 12h18M12 3c2.5 2.7 3.8 6 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-6-3.8-9s1.3-6.3 3.8-9z" />
	</svg>
)
const PLUS_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M12 5v14M5 12h14" />
	</svg>
)

function basename(p: string) {
	return p.trim().replace(/\/+$/, '').split('/').pop() || p
}

// "Browse folder"는 이미 완결된 실기능(FolderBrowserModal, /api/setup/fs/*)을 그대로 재사용 —
// 즉시 등록. "Clone from URL"/"Create new project"는 그 아래 인라인 폼으로 펼쳐서 대상 폴더를
// 같은 FolderBrowserModal로 고르게 한다(부모 폴더 아래에 새 디렉토리를 만드는 흐름이라 폴더
// 자체가 아니라 "어디 밑에 만들지"를 고르는 거라 별도 목적으로 재사용).
//
// Electron 셸에서는 FolderBrowserModal(서버 기반 브라우저) 대신 OS 네이티브 폴더 선택
// 다이얼로그(window.openrm.pickFolder — preload.cjs)를 우선 사용한다: 실제 절대경로를 바로
// 주기 때문에 브라우저 dev 모드보다 더 편하다. 브라우저 dev 모드(window.openrm 없음)에서는
// 네이티브 다이얼로그를 쓸 수 없으므로 기존 FolderBrowserModal로 폴백한다.
export default function AddRepoModal({ open, onClose, onManage }: { open: boolean; onClose(): void; onManage(): void }) {
	const createRepo = useSessionsStore((s) => s.createRepo)
	const cloneRepo = useSessionsStore((s) => s.cloneRepo)
	const initRepo = useSessionsStore((s) => s.initRepo)

	const [mode, setMode] = useState<'main' | 'clone' | 'init'>('main')
	const [browsingFor, setBrowsingFor] = useState<'browse' | 'clone' | 'init' | null>(null)
	const [cloneUrl, setCloneUrl] = useState('')
	const [cloneParent, setCloneParent] = useState('')
	const [initName, setInitName] = useState('')
	const [initParent, setInitParent] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	function reset() {
		setMode('main')
		setBrowsingFor(null)
		setCloneUrl('')
		setCloneParent('')
		setInitName('')
		setInitParent('')
		setBusy(false)
		setError(null)
	}
	function close() {
		reset()
		onClose()
	}

	async function submitBrowse(path: string) {
		setBrowsingFor(null)
		setBusy(true)
		setError(null)
		await createRepo({ name: basename(path), path })
		setBusy(false)
		close()
	}
	// Electron 셸에서는 OS 네이티브 폴더 선택 다이얼로그를 우선 쓰고, 브라우저 dev 모드에선
	// 기존 FolderBrowserModal(서버 기반)로 폴백한다.
	async function pickFolder(target: 'browse' | 'clone' | 'init') {
		if (!window.openrm?.isElectron) {
			setBrowsingFor(target)
			return
		}
		const r = await window.openrm.pickFolder({ title: '폴더 선택' })
		if (!r.ok) return
		if (target === 'browse') submitBrowse(r.path)
		else if (target === 'clone') setCloneParent(r.path)
		else setInitParent(r.path)
	}
	async function submitClone() {
		if (!cloneUrl.trim() || !cloneParent.trim() || busy) return
		setBusy(true)
		setError(null)
		const r = await cloneRepo({ url: cloneUrl.trim(), parentPath: cloneParent.trim() })
		setBusy(false)
		if (r.ok) close()
		else setError(r.error || 'clone 실패')
	}
	async function submitInit() {
		if (!initName.trim() || !initParent.trim() || busy) return
		setBusy(true)
		setError(null)
		const r = await initRepo({ parentPath: initParent.trim(), name: initName.trim() })
		setBusy(false)
		if (r.ok) close()
		else setError(r.error || '생성 실패')
	}

	return (
		<>
			<Modal open={open && !browsingFor} onClose={close} width={480}>
				<div className={styles.pad}>
					<div className={styles.title}>레포 추가</div>

					{mode === 'main' && (
						<>
							<button className={styles.primaryOpt} onClick={() => pickFolder('browse')}>
								<span className={styles.optIcon}>{FOLDER_ICON}</span>
								<span className={styles.optBody}>
									<span className={styles.optTitle}>폴더 찾아보기</span>
									<span className={styles.optSub}>로컬 프로젝트, git 레포, 또는 여러 레포가 있는 폴더</span>
								</span>
							</button>

							<div className={styles.sectionLabel}>다른 방법</div>
							<div className={styles.otherOpts}>
								<button className={styles.otherOpt} onClick={() => setMode('clone')}>
									<span className={styles.otherIcon}>{GLOBE_ICON}</span>
									<span className={styles.optBody}>
										<span className={styles.optTitle}>URL에서 클론</span>
										<span className={styles.optSub}>원격 git 레포를 클론</span>
									</span>
								</button>
								<button className={styles.otherOpt} onClick={() => setMode('init')}>
									<span className={styles.otherIcon}>{PLUS_ICON}</span>
									<span className={styles.optBody}>
										<span className={styles.optTitle}>새 프로젝트 만들기</span>
										<span className={styles.optSub}>빈 폴더에서 시작(git init)</span>
									</span>
								</button>
							</div>

							<div className={styles.manageLink} onClick={() => { close(); onManage() }}>
								등록된 레포 관리
							</div>
						</>
					)}

					{mode === 'clone' && (
						<div className={styles.form}>
							<label className={styles.label}>Git URL</label>
							<input className={`fin m ${styles.input}`} value={cloneUrl} onChange={(e) => setCloneUrl(e.target.value)} placeholder="https://github.com/org/repo.git" autoFocus />
							<label className={styles.label}>대상 폴더</label>
							<div className={styles.pathRow}>
								<span className={`m ${styles.pathText}`}>{cloneParent || '(선택 안 됨)'}</span>
								<button className={styles.pickBtn} onClick={() => pickFolder('clone')}>
									찾아보기
								</button>
							</div>
							{error && <div className={styles.error}>{error}</div>}
							<div className={styles.formActions}>
								<button className={styles.ghostBtn} onClick={() => { setMode('main'); setError(null) }}>
									뒤로
								</button>
								<button className={styles.primaryBtn} disabled={busy || !cloneUrl.trim() || !cloneParent.trim()} onClick={submitClone}>
									{busy ? '클론 중…' : '클론'}
								</button>
							</div>
						</div>
					)}

					{mode === 'init' && (
						<div className={styles.form}>
							<label className={styles.label}>프로젝트 이름</label>
							<input className={`fin m ${styles.input}`} value={initName} onChange={(e) => setInitName(e.target.value)} placeholder="my-new-project" autoFocus />
							<label className={styles.label}>위치</label>
							<div className={styles.pathRow}>
								<span className={`m ${styles.pathText}`}>{initParent || '(선택 안 됨)'}</span>
								<button className={styles.pickBtn} onClick={() => pickFolder('init')}>
									찾아보기
								</button>
							</div>
							{error && <div className={styles.error}>{error}</div>}
							<div className={styles.formActions}>
								<button className={styles.ghostBtn} onClick={() => { setMode('main'); setError(null) }}>
									뒤로
								</button>
								<button className={styles.primaryBtn} disabled={busy || !initName.trim() || !initParent.trim()} onClick={submitInit}>
									{busy ? '생성 중…' : '만들기'}
								</button>
							</div>
						</div>
					)}
				</div>
			</Modal>

			<FolderBrowserModal
				open={!!browsingFor}
				startPath="~"
				onClose={() => setBrowsingFor(null)}
				onSelect={(p) => {
					if (browsingFor === 'browse') submitBrowse(p)
					else if (browsingFor === 'clone') { setCloneParent(p); setBrowsingFor(null) }
					else if (browsingFor === 'init') { setInitParent(p); setBrowsingFor(null) }
				}}
			/>
		</>
	)
}
