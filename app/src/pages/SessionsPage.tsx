import { useEffect, useState } from 'react'
import { useSetupStore, isSetupConfigured } from '../store/useSetupStore'
import { useSessionsStore } from '../store/useSessionsStore'
import FolderPicker from '../components/sessions/FolderPicker'
import SetupGate from '../components/common/SetupGate'
import SessionShell from '../components/sessions/SessionShell'

// Reuses the same rootPath/wtPath/branchPrefix fields the Setup page's 'paths'
// step edits (single source of truth, two entry points) — see plan principle 5.
function SessionsSetupGate() {
	const [rootPath, setRootPathLocal] = useState('')
	const [wtPath, setWtPathLocal] = useState('')
	const [branchPrefix, setBranchPrefixLocal] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const syncConnector = useSetupStore((s) => s.syncConnector)

	const canSave = !!rootPath.trim() && !!wtPath.trim()

	async function save() {
		if (!canSave) return
		setBusy(true)
		setError(null)
		try {
			await syncConnector('paths', { rootPath, wtPath, branchPrefix })
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	return (
		<SetupGate
			icon={
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
					<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
				</svg>
			}
			title="개발실을 시작하려면 폴더 위치를 정하세요"
			subtitle="각 태스크가 여기 기준으로 격리 git 워크트리로 생성됩니다"
			canSave={canSave}
			busy={busy}
			error={error}
			saveLabel="개발실 열기"
			onSave={save}
		>
			<div>
				<div style={{ fontSize: 10.5, color: 'var(--t3)', marginBottom: 6 }}>프로젝트 루트 (기본 레포)</div>
				<FolderPicker label="프로젝트 루트" value={rootPath} onChange={setRootPathLocal} kind="root" />
			</div>
			<div>
				<div style={{ fontSize: 10.5, color: 'var(--t3)', marginBottom: 6 }}>워크트리 생성 위치</div>
				<FolderPicker label="워크트리 위치" value={wtPath} onChange={setWtPathLocal} kind="worktree" />
			</div>
			<div>
				<div style={{ fontSize: 10.5, color: 'var(--t3)', marginBottom: 6 }}>브랜치 prefix (선택)</div>
				<input className="fin m" placeholder="GBIZ-" value={branchPrefix} onChange={(e) => setBranchPrefixLocal(e.target.value)} />
			</div>
		</SetupGate>
	)
}

export default function SessionsPage() {
	const configured = useSetupStore(isSetupConfigured)
	const hydrateSetup = useSetupStore((s) => s.hydrate)
	const loadBoard = useSessionsStore((s) => s.loadBoard)
	const loadRepos = useSessionsStore((s) => s.loadRepos)

	useEffect(() => {
		hydrateSetup()
	}, [hydrateSetup])

	useEffect(() => {
		if (configured) {
			loadBoard()
			loadRepos()
		}
	}, [configured, loadBoard, loadRepos])

	if (!configured) return <SessionsSetupGate />

	return <SessionShell />
}
