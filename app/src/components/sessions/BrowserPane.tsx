import { useEffect, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import { useSetupStore } from '../../store/useSetupStore'
import { useBrowserNavStore } from '../../store/useBrowserNavStore'
import { useTp } from '../../utils/i18n'
import BrowserToolbar from './BrowserToolbar'

// 로그인 세션이 없는 사이트를 새 Chromium으로 열 때마다 다시 로그인해야 했던 문제(§Playwright 시절)를
// 없애려고 모든 인앱 브라우저 탭이 같은 파티션(=같은 쿠키/로그인)을 공유한다 — 한 번 로그인하면 다른
// 태스크의 "브라우저" 탭에서도 로그인 상태가 유지된다. 특정 태스크만 격리하고 싶다는 요구가 나오면
// 그때 taskId별 파티션(`persist:browser-${taskId}`)으로 쪼갠다.
const PARTITION = 'persist:opentask-browser'

function normalizeUrl(input: string) {
	const v = input.trim()
	if (!v) return v
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v
	if (/^localhost(:\d+)?(\/|$)/i.test(v) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(v)) return 'http://' + v
	return 'https://' + v
}

// "플레이라이트말고 브라우저 자체를 못띄우나?" — 스크린샷 폴링 대신 Electron 네이티브 <webview>를
// 그대로 붙인다. 화면 비율·해상도 문제가 원천적으로 없고(진짜 렌더링이라 object-fit 레터박싱 없음),
// PARTITION으로 로그인 세션도 유지된다. 대신 지휘자(AI)가 headless Playwright로 조작하던 것과는 이제
// 완전히 분리된 세션이다 — 사람이 지휘자의 화면을 "그대로" 지켜보는 건 이번엔 포기했다(§AskUserQuestion
// "webview로 완전히 전환" 선택 시 사용자가 인지하고 받아들인 트레이드오프).
//
// ref 타입은 @types/react의 HTMLWebViewElement로 받는다(빈 껍데기지만 JSX 쪽엔 이게 맞음) — 실제
// electron 메서드(loadURL/goBack/openDevTools 등)를 부를 땐 tag()로 electron.WebviewTag로 캐스팅해서
// 쓴다(HTMLWebViewElement에 electron 타입을 직접 병합하면 addEventListener 오버로드가 HTMLElement 것과
// 충돌해 타입체크가 깨진다 — 캐스팅이 더 단순하고 안전).
export default function BrowserPane({ taskId, cwd }: { taskId: string; cwd: string | null }) {
	const tp = useTp()
	const configuredDevUrl = useSetupStore((s) => s.connectors['dev']?.fields.devServerUrl)
	const webviewRef = useRef<HTMLWebViewElement>(null)
	const tag = () => webviewRef.current as unknown as WebviewTag | null

	// 탭이 막 열리는 이 순간 이미 XTerm이 남겨둔 요청(§useBrowserNavStore)이 있으면 그 URL로 시작한다
	// — webview는 dom-ready 전엔 loadURL()을 호출할 수 없어(Electron 제약) 첫 화면은 반드시 src
	// 속성으로 줘야 한다. 이후에 오는 요청(이미 dom-ready 지난 뒤)만 아래 effect가 loadURL로 처리한다.
	const initialPending = useBrowserNavStore.getState().pending
	const startUrl = initialPending?.nodeId === taskId ? initialPending.url : configuredDevUrl || 'http://localhost:3000'
	const initialUrlRef = useRef(startUrl)
	const consumedNonceRef = useRef(initialPending?.nodeId === taskId ? initialPending.nonce : -1)

	const [url, setUrl] = useState(initialUrlRef.current)
	const [loading, setLoading] = useState(true)
	const [canGoBack, setCanGoBack] = useState(false)
	const [canGoForward, setCanGoForward] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [device, setDevice] = useState<'pc' | 'mobile'>('pc')

	useEffect(() => {
		const wv = tag()
		if (!wv) return
		const syncNav = () => {
			setCanGoBack(wv.canGoBack())
			setCanGoForward(wv.canGoForward())
		}
		const onStart = () => {
			setLoading(true)
			setError(null)
		}
		const onStop = () => {
			setLoading(false)
			setUrl(wv.getURL())
			syncNav()
		}
		const onNavigate = (e: { url: string }) => {
			setUrl(e.url)
			syncNav()
		}
		const onFail = (e: Electron.DidFailLoadEvent) => {
			// -3(ERR_ABORTED)은 리다이렉트·다운로드 시작 등으로 흔히 발생 — 진짜 에러가 아니라 무시.
			if (e.errorCode === -3) return
			setLoading(false)
			setError(tp('로드 실패: {detail}', { detail: e.errorDescription || e.errorCode }))
		}
		wv.addEventListener('did-start-loading', onStart)
		wv.addEventListener('did-stop-loading', onStop)
		wv.addEventListener('did-navigate', onNavigate)
		wv.addEventListener('did-navigate-in-page', onNavigate)
		wv.addEventListener('did-fail-load', onFail)
		return () => {
			wv.removeEventListener('did-start-loading', onStart)
			wv.removeEventListener('did-stop-loading', onStop)
			wv.removeEventListener('did-navigate', onNavigate)
			wv.removeEventListener('did-navigate-in-page', onNavigate)
			wv.removeEventListener('did-fail-load', onFail)
		}
	}, [])

	// "링크누르면 앱내 브라우저로 이동" — 마운트 시점의 요청은 위 startUrl(src)로 이미 처리했다. 탭이
	// 열려 있는 동안 또 다른 링크를 클릭하는 경우만 여기서 loadURL로 반영한다(dom-ready 지난 뒤라 안전).
	useEffect(() => {
		return useBrowserNavStore.subscribe((s) => {
			if (s.pending?.nodeId === taskId && s.pending.nonce !== consumedNonceRef.current) {
				consumedNonceRef.current = s.pending.nonce
				tag()?.loadURL(s.pending.url)
			}
		})
	}, [taskId])

	return (
		<div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
			<BrowserToolbar
				url={url}
				loading={loading}
				canGoBack={canGoBack}
				canGoForward={canGoForward}
				error={error}
				device={device}
				cwd={cwd}
				onBack={() => tag()?.goBack()}
				onForward={() => tag()?.goForward()}
				onReload={() => tag()?.reload()}
				onNavigate={(v) => tag()?.loadURL(normalizeUrl(v))}
				onOpenDevtools={() => tag()?.openDevTools()}
				onDeviceChange={setDevice}
			/>
			<div
				style={{
					flex: 1,
					minHeight: 0,
					position: 'relative',
					overflow: 'hidden',
					display: 'flex',
					justifyContent: 'center',
					padding: device === 'mobile' ? '24px 0' : 0,
					boxSizing: 'border-box',
					background: device === 'mobile' ? '#15181d' : 'var(--bg)',
				}}
			>
				<webview
					ref={webviewRef}
					src={initialUrlRef.current}
					partition={PARTITION}
					allowpopups
					style={{ width: device === 'mobile' ? 390 : '100%', height: '100%', border: 'none', borderRadius: device === 'mobile' ? 12 : 0 }}
				/>
			</div>
		</div>
	)
}
