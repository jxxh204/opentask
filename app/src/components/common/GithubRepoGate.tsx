import { useState } from 'react'
import { useSetupStore } from '../../store/useSetupStore'
import SetupGate from './SetupGate'

export default function GithubRepoGate({ title, subtitle }: { title: string; subtitle: string }) {
	const [repo, setRepo] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const syncConnector = useSetupStore((s) => s.syncConnector)

	const canSave = !!repo.trim() && /^[^/\s]+\/[^/\s]+(,[^/\s]+\/[^/\s]+)*$/.test(repo.trim())

	async function save() {
		if (!canSave) return
		setBusy(true)
		setError(null)
		try {
			await syncConnector('github', { repo: repo.trim() })
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
					<path d="M12 3.2a8.8 8.8 0 1 0 6.3 2.5" />
					<circle cx="18.3" cy="5.7" r="2.7" fill="var(--blue)" />
				</svg>
			}
			title={title}
			subtitle={subtitle}
			canSave={canSave}
			busy={busy}
			error={error}
			saveLabel="연결"
			onSave={save}
		>
			<div>
				<div style={{ fontSize: 10.5, color: 'var(--t3)', marginBottom: 6 }}>GitHub 레포 (owner/repo, 콤마로 여러 개 가능)</div>
				<input className="fin m" placeholder="octocat/hello-world" value={repo} onChange={(e) => setRepo(e.target.value)} />
			</div>
		</SetupGate>
	)
}
