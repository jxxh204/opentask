import { useEffect, useState } from 'react'
import { getAwsMfaStatus, renewAwsMfa, type AwsMfaStatus } from '../../api/monitor'
import StatusDot from '../common/StatusDot'
import styles from './AwsMfaPanel.module.css'

const POLL_MS = 30000

function formatRemaining(ms: number | null): string {
	if (ms == null) return ''
	const totalMin = Math.max(0, Math.floor(ms / 60000))
	const h = Math.floor(totalMin / 60)
	const m = totalMin % 60
	return h > 0 ? `${h}시간 ${m}분 남음` : `${m}분 남음`
}

// AWS MFA 세션 갱신 — 읽기전용 STS 호출(get-session-token/get-caller-identity)만 사용(server/aws.cjs 참고).
// mfa_serial이 설정 안 돼있으면(hasSerial=false) 애초에 이 기능을 안 쓰는 환경 — 조용히 숨김.
export default function AwsMfaPanel() {
	const [status, setStatus] = useState<AwsMfaStatus | null>(null)
	const [code, setCode] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		function load() {
			getAwsMfaStatus()
				.then((s) => !cancelled && setStatus(s))
				.catch(() => {})
		}
		load()
		const timer = setInterval(load, POLL_MS)
		return () => {
			cancelled = true
			clearInterval(timer)
		}
	}, [])

	if (!status || !status.hasSerial) return null // mfa_serial 미설정 — 이 기능 자체를 안 쓰는 환경

	async function renew() {
		if (!/^\d{6}$/.test(code)) {
			setError('6자리 숫자를 입력하세요.')
			return
		}
		setBusy(true)
		setError(null)
		try {
			const r = await renewAwsMfa(code)
			if (!r.ok) setError(r.error || '갱신 실패')
			else setCode('')
			setStatus(await getAwsMfaStatus(true))
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className={styles.panel}>
			<div className={styles.title}>☁️ AWS MFA 세션 (읽기전용)</div>
			<div className={styles.statusRow}>
				<StatusDot color={status.valid ? 'green' : 'amber'} />
				<span style={{ color: status.valid ? 'var(--green)' : 'var(--amber)', fontWeight: 700 }}>{status.valid ? '인증됨' : '인증 필요'}</span>
			</div>
			<div className={styles.meta}>
				{status.valid && status.account && <div>계정 {status.account}</div>}
				{status.valid && status.remainingMs != null && <div>{formatRemaining(status.remainingMs)}</div>}
				{!status.valid && status.error && <div>{status.error}</div>}
			</div>
			<div className={styles.form}>
				<input
					className={`fin m ${styles.codeInput}`}
					value={code}
					placeholder="000000"
					maxLength={6}
					inputMode="numeric"
					onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
					onKeyDown={(e) => e.key === 'Enter' && renew()}
				/>
				<button className={styles.renewBtn} disabled={busy || code.length !== 6} onClick={renew}>
					{busy ? '갱신 중…' : '갱신'}
				</button>
			</div>
			{error && <div className={styles.errorText}>{error}</div>}
		</div>
	)
}
