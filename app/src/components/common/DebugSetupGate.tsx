import { useState } from 'react'
import { useSetupStore } from '../../store/useSetupStore'
import SetupGate from './SetupGate'

export default function DebugSetupGate() {
	const [devServerUrl, setDevServerUrl] = useState('http://localhost:3000')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const syncConnector = useSetupStore((s) => s.syncConnector)

	const canSave = !!devServerUrl.trim()

	async function save() {
		if (!canSave) return
		setBusy(true)
		setError(null)
		try {
			await syncConnector('dev', { devServerUrl: devServerUrl.trim() })
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
					<rect x="3" y="4" width="18" height="13" rx="2" />
					<path d="M8 21h8M12 17v4" />
				</svg>
			}
			title="디버깅을 시작하려면 개발 서버 주소를 정하세요"
			subtitle="이 주소의 실시간 프리뷰·요소 지목·네트워크/콘솔을 볼 수 있습니다"
			canSave={canSave}
			busy={busy}
			error={error}
			saveLabel="디버깅 열기"
			onSave={save}
		>
			<div>
				<div style={{ fontSize: 10.5, color: 'var(--t3)', marginBottom: 6 }}>개발 서버 주소</div>
				<input className="fin m" placeholder="http://localhost:3000" value={devServerUrl} onChange={(e) => setDevServerUrl(e.target.value)} />
			</div>
		</SetupGate>
	)
}
