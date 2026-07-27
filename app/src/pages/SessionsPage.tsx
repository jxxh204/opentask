import { useEffect, useState } from 'react'
import { useSetupStore, isSetupConfigured } from '../store/useSetupStore'
import { useSessionsStore } from '../store/useSessionsStore'
import FolderPicker from '../components/sessions/FolderPicker'
import TaskComposer from '../components/sessions/TaskComposer'
import InboxSection from '../components/sessions/InboxSection'
import FolderCard from '../components/sessions/FolderCard'
import PrReviewModal from '../components/sessions/PrReviewModal'
import styles from './SessionsPage.module.css'

// Reuses the same rootPath/wtPath/branchPrefix fields the Setup page's 'paths'
// step edits (single source of truth, two entry points) — see plan principle 5.
function SetupGate() {
	const [rootPath, setRootPathLocal] = useState('')
	const [wtPath, setWtPathLocal] = useState('')
	const [branchPrefix, setBranchPrefixLocal] = useState('')
	const syncConnector = useSetupStore((s) => s.syncConnector)

	const canSave = !!rootPath.trim() && !!wtPath.trim()

	return (
		<div className={styles.gateWrap}>
			<div className={styles.gateCard}>
				<div className={styles.gateHead}>
					<span className={styles.gateIcon}>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
							<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
						</svg>
					</span>
					<div>
						<div className={styles.gateTitle}>개발실을 시작하려면 폴더 위치를 정하세요</div>
						<div className={styles.gateSub}>각 태스크가 여기 기준으로 격리 git 워크트리로 생성됩니다</div>
					</div>
				</div>
				<div className={styles.gateFields}>
					<div>
						<div className={styles.gateFieldLabel}>프로젝트 루트 (기본 레포)</div>
						<FolderPicker label="프로젝트 루트" value={rootPath} onChange={setRootPathLocal} kind="root" />
					</div>
					<div>
						<div className={styles.gateFieldLabel}>워크트리 생성 위치</div>
						<FolderPicker label="워크트리 위치" value={wtPath} onChange={setWtPathLocal} kind="worktree" />
					</div>
					<div>
						<div className={styles.gateFieldLabel}>브랜치 prefix (선택)</div>
						<input className="fin m" placeholder="GBIZ-" value={branchPrefix} onChange={(e) => setBranchPrefixLocal(e.target.value)} />
					</div>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20 }}>
					<button
						className={`${styles.gateGoBtn} ${canSave ? styles.gateGoBtnReady : ''}`}
						disabled={!canSave}
						onClick={() => canSave && syncConnector('paths', { rootPath, wtPath, branchPrefix })}
					>
						개발실 열기
					</button>
					<span style={{ fontSize: 11, color: 'var(--t3)' }}>로컬에만 저장</span>
				</div>
			</div>
		</div>
	)
}

export default function SessionsPage() {
	const configured = useSetupStore(isSetupConfigured)
	const hydrateSetup = useSetupStore((s) => s.hydrate)
	const folders = useSessionsStore((s) => s.folders)
	const inbox = useSessionsStore((s) => s.inbox)
	const loadBoard = useSessionsStore((s) => s.loadBoard)
	const createFolder = useSessionsStore((s) => s.createFolder)

	useEffect(() => {
		hydrateSetup()
	}, [hydrateSetup])

	useEffect(() => {
		if (configured) loadBoard()
	}, [configured, loadBoard])

	if (!configured) return <SetupGate />

	const totalTasks = inbox.length + folders.reduce((n, f) => n + f.tasks.length, 0)

	return (
		<div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
			<div className={styles.topbar}>
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
					<path d="M12 3.2a8.8 8.8 0 1 0 6.3 2.5" stroke="var(--violet)" strokeWidth={2.6} strokeLinecap="round" />
					<circle cx="18.3" cy="5.7" r="2.7" fill="var(--blue)" />
				</svg>
				<span className={styles.title}>개발실</span>
				<span className={`m ${styles.counts}`}>
					{folders.length} folders · {totalTasks} tasks
				</span>
			</div>

			<div className={styles.composerWrap}>
				<TaskComposer />
			</div>

			<div className={`scroll-y ${styles.board}`}>
				<div className={styles.boardInner}>
					<InboxSection tasks={inbox} />
					{folders.map((f) => (
						<FolderCard key={f.id} folder={f} />
					))}
					<button className={styles.addFolderBtn} onClick={() => createFolder('새 폴더')}>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
							<path d="M12 5v14M5 12h14" />
						</svg>
						새 폴더 만들기
					</button>
				</div>
			</div>
			<PrReviewModal />
		</div>
	)
}
