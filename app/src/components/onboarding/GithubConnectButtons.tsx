import { useEffect, useRef, useState } from 'react'
import { useSetupStore } from '../../store/useSetupStore'
import { getGhCliStatus, startGithubOAuth, pollGithubOAuth } from '../../api/setup'
import styles from './GithubConnectButtons.module.css'

type GhState = { checking: boolean; loggedIn: boolean | null; username: string | null; error: string | null }
type OauthState = { phase: 'idle' | 'need-client-id' | 'pending' | 'done' | 'error'; userCode: string | null; verificationUri: string | null; username: string | null; error: string | null }

// GitHub를 "버튼 한 번"으로 연동하는 두 방법. repo 필드(어느 레포를 볼지)와는 별개 — 이건 "어떤 방식으로
// 인증할지"만 다룬다. 이 앱의 GitHub 관련 기능은 전부 gh CLI로 동작하므로(server/ghEnv.cjs), 로컬에
// 이미 로그인돼 있으면 ①로 설정 0으로 끝나고, 아니면 ②로 브라우저에서 진짜 GitHub 로그인 화면을 띄운다.
export default function GithubConnectButtons() {
	const connectors = useSetupStore((s) => s.connectors)
	const syncConnector = useSetupStore((s) => s.syncConnector)
	const clientId = connectors.githubOAuth?.fields.clientId ?? ''
	const [clientIdDraft, setClientIdDraft] = useState(clientId)

	const [gh, setGh] = useState<GhState>({ checking: false, loggedIn: null, username: null, error: null })
	const [oauth, setOauth] = useState<OauthState>({ phase: 'idle', userCode: null, verificationUri: null, username: null, error: null })
	const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => () => {
		if (pollTimer.current) clearTimeout(pollTimer.current)
	}, [])

	async function checkGhCli() {
		setGh({ checking: true, loggedIn: null, username: null, error: null })
		try {
			const r = await getGhCliStatus()
			setGh({ checking: false, loggedIn: r.loggedIn, username: r.username ?? null, error: null })
		} catch (e) {
			setGh({ checking: false, loggedIn: null, username: null, error: e instanceof Error ? e.message : String(e) })
		}
	}

	async function beginOauth() {
		if (!clientId.trim()) {
			setOauth({ phase: 'need-client-id', userCode: null, verificationUri: null, username: null, error: null })
			return
		}
		setOauth({ phase: 'pending', userCode: null, verificationUri: null, username: null, error: null })
		try {
			const r = await startGithubOAuth()
			setOauth({ phase: 'pending', userCode: r.userCode ?? null, verificationUri: r.verificationUri ?? null, username: null, error: null })
			schedulePoll(Math.max(2, r.interval ?? 5) * 1000)
		} catch (e) {
			setOauth({ phase: 'error', userCode: null, verificationUri: null, username: null, error: e instanceof Error ? e.message : String(e) })
		}
	}

	function schedulePoll(ms: number) {
		pollTimer.current = setTimeout(async () => {
			try {
				const r = await pollGithubOAuth()
				if (r.done) {
					setOauth((o) => ({ ...o, phase: 'done', username: r.username ?? null }))
				} else {
					schedulePoll(r.slowDown ? ms + 5000 : ms)
				}
			} catch (e) {
				setOauth((o) => ({ ...o, phase: 'error', error: e instanceof Error ? e.message : String(e) }))
			}
		}, ms)
	}

	async function saveClientIdAndStart() {
		await syncConnector('githubOAuth', { clientId: clientIdDraft.trim() })
		setOauth({ phase: 'idle', userCode: null, verificationUri: null, username: null, error: null })
		setTimeout(beginOauth, 0)
	}

	return (
		<div className={styles.wrap}>
			<div className={styles.row}>
				<button className={styles.btn} disabled={gh.checking} onClick={checkGhCli}>
					{gh.checking ? '확인 중…' : '① gh CLI로 연동 확인'}
				</button>
				{gh.loggedIn === true && <span className={styles.ok}>✓ {gh.username}로 연동됨 (gh CLI)</span>}
				{gh.loggedIn === false && <span className={styles.warn}>로그인 안 됨 — 터미널에서 `gh auth login` 실행 후 다시 시도</span>}
				{gh.error && <span className={styles.err}>{gh.error}</span>}
			</div>

			<div className={styles.row}>
				<button className={styles.btn} disabled={oauth.phase === 'pending'} onClick={beginOauth}>
					② GitHub로 로그인 (OAuth)
				</button>
				{oauth.phase === 'done' && <span className={styles.ok}>✓ {oauth.username}로 연동됨 (OAuth)</span>}
				{oauth.phase === 'error' && <span className={styles.err}>{oauth.error}</span>}
			</div>

			{oauth.phase === 'need-client-id' && (
				<div className={styles.clientIdBox}>
					<p className={styles.hint}>
						처음 한 번만 필요 — GitHub의{' '}
						<a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer">
							OAuth App 등록 화면
						</a>
						에서 이름만 아무거나 정해 만들고, "Enable Device Flow"를 켠 뒤 Client ID를 여기 붙여넣으세요. Callback URL은 아무 값이나 넣어도 됩니다(Device Flow는 안 씀).
					</p>
					<div className={styles.clientIdRow}>
						<input className="fin m" value={clientIdDraft} placeholder="Iv1.xxxxxxxxxxxxxxxx" onChange={(e) => setClientIdDraft(e.target.value)} />
						<button className={styles.btn} onClick={saveClientIdAndStart} disabled={!clientIdDraft.trim()}>
							저장하고 시작
						</button>
					</div>
				</div>
			)}

			{oauth.phase === 'pending' && oauth.userCode && (
				<div className={styles.deviceBox}>
					<div className={styles.userCode}>{oauth.userCode}</div>
					<a className={styles.btn} href={oauth.verificationUri ?? 'https://github.com/login/device'} target="_blank" rel="noreferrer">
						GitHub 열기 →
					</a>
					<span className={styles.hint}>이 코드를 입력하고 승인하면 자동으로 연동됩니다.</span>
				</div>
			)}
		</div>
	)
}
