import { useEffect, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import { useSetupStore } from '../../store/useSetupStore'
import { useBrowserNavStore } from '../../store/useBrowserNavStore'
import { useSessionsStore } from '../../store/useSessionsStore'
import { useTp } from '../../utils/i18n'
import BrowserToolbar from './BrowserToolbar'
import styles from './BrowserPane.module.css'

// "이런식으로 요소들을 볼 수 있고" — webview 안에서 실행해 마우스오버 하이라이트 + 클릭으로 확정하는
// 자기완결 스크립트. main.cjs의 will-attach-webview가 게스트 webview의 preload를 의도적으로 강제
// 제거하므로(§ 그 파일 주석 — 게스트 안에서 Node API에 닿으면 안 된다는 보안 경계, 이번에 안 건드림)
// executeJavaScript()만으로 처리한다 — 이건 페이지 자신의 JS가 하는 것과 동급이라 그 경계와 무관하다.
// 재클릭(취소)을 위해 window에 취소 함수를 걸어두고, 별도의 짧은 executeJavaScript 호출로 그걸 부른다.
const PICKER_SCRIPT = `(function(){
  if (window.__openTaskPicking) return null
  window.__openTaskPicking = true
  return new Promise(function(resolve){
    var prevCursor = document.body.style.cursor
    var highlighted = null
    var prevOutline = ''
    function clearHighlight(){ if (highlighted) { highlighted.style.outline = prevOutline; highlighted = null } }
    function cleanup(){
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey, true)
      clearHighlight()
      document.body.style.cursor = prevCursor
      window.__openTaskPicking = false
      window.__openTaskCancelPicker = null
    }
    function onMove(e){
      var el = e.target
      if (el === highlighted) return
      clearHighlight()
      highlighted = el
      prevOutline = el.style.outline
      el.style.outline = '2px solid #9ba4b3'
    }
    function cssSelector(el){
      if (el.id) return '#' + el.id
      var parts = []
      var node = el
      while (node && node.nodeType === 1 && parts.length < 5) {
        var part = node.tagName.toLowerCase()
        if (node.className && typeof node.className === 'string') {
          var cls = node.className.trim().split(' ').filter(Boolean).slice(0, 2).join('.')
          if (cls) part += '.' + cls
        }
        var parent = node.parentElement
        if (parent) part += ':nth-child(' + (Array.prototype.indexOf.call(parent.children, node) + 1) + ')'
        parts.unshift(part)
        node = parent
      }
      return parts.join(' > ')
    }
    function domPath(el){
      var chain = []
      var node = el
      while (node && node.tagName && chain.length < 6) { chain.unshift(node.tagName.toLowerCase()); node = node.parentElement }
      return chain.join(' > ')
    }
    function onClick(e){
      e.preventDefault()
      e.stopPropagation()
      var el = e.target
      var rect = el.getBoundingClientRect()
      var cs = window.getComputedStyle(el)
      var result = {
        tag: el.tagName.toLowerCase(),
        selector: cssSelector(el),
        text: (el.innerText || el.textContent || '').trim().slice(0, 300),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        styles: { display: cs.display, position: cs.position, color: cs.color, backgroundColor: cs.backgroundColor, fontSize: cs.fontSize, fontWeight: cs.fontWeight },
        html: el.outerHTML.slice(0, 1500),
        domPath: domPath(el),
      }
      cleanup()
      resolve(result)
    }
    function onKey(e){ if (e.key === 'Escape') { cleanup(); resolve(null) } }
    window.__openTaskCancelPicker = function(){ cleanup(); resolve(null) }
    document.body.style.cursor = 'crosshair'
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
  })
})()`

interface PickedElement {
	tag: string
	selector: string
	text: string
	width: number
	height: number
	styles: Record<string, string>
	html: string
	domPath: string
}

const COPY_ICON = (
	<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<rect x="9" y="9" width="12" height="12" rx="2" />
		<path d="M5 15V5a2 2 0 0 1 2-2h10" />
	</svg>
)
const SEND_ICON = (
	<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round">
		<path d="M12 19V6M6 11l6-6 6 6" />
	</svg>
)

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
export default function BrowserPane({ taskId, cwd, folderId }: { taskId: string; cwd: string | null; folderId: string | null }) {
	const tp = useTp()
	const configuredDevUrl = useSetupStore((s) => s.connectors['dev']?.fields.devServerUrl)
	const tellConductor = useSessionsStore((s) => s.tellConductor)
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
	const [picking, setPicking] = useState(false)
	const [pickedElement, setPickedElement] = useState<PickedElement | null>(null)
	const [instruction, setInstruction] = useState('')
	const [sending, setSending] = useState(false)
	const [copied, setCopied] = useState(false)

	async function onTogglePicker() {
		if (picking) {
			await tag()
				?.executeJavaScript('window.__openTaskCancelPicker && window.__openTaskCancelPicker()')
				.catch(() => {})
			return
		}
		setPicking(true)
		try {
			const result = await tag()?.executeJavaScript(PICKER_SCRIPT)
			if (result) setPickedElement(result as PickedElement)
		} catch {
			// 페이지가 피킹 도중 이동했을 수 있음 — 조용히 무시.
		} finally {
			setPicking(false)
		}
	}

	function handleCopy() {
		if (!pickedElement) return
		const text = `${pickedElement.selector}\n${pickedElement.text}\n\n${pickedElement.html}`
		navigator.clipboard
			.writeText(text)
			.then(() => {
				setCopied(true)
				setTimeout(() => setCopied(false), 1500)
			})
			.catch(() => {})
	}

	// "우리는 현재 메인태스크에 보낼 수 있도록해줘" — 즉시 전송이 아니라 요소+지시를 하나로 묶어서
	// 그 폴더의 지휘자(메인 태스크) pty에 능동 전송(§ tellConductor, orchestrator.cjs conductorTell과
	// 완전히 같은 경로 — API/스토어는 이미 있었는데 실제로 부르는 UI가 없었다).
	async function handleSend() {
		if (!pickedElement || !folderId || !instruction.trim() || sending) return
		setSending(true)
		try {
			const combined = `[화면 요소 참조] ${pickedElement.selector} · ${pickedElement.tag} · ${pickedElement.width}x${pickedElement.height}\n텍스트: "${pickedElement.text}"\nHTML: ${pickedElement.html}\n\n${instruction.trim()}`
			await tellConductor(folderId, combined)
			setPickedElement(null)
			setInstruction('')
		} finally {
			setSending(false)
		}
	}

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
				pickerActive={picking}
				onBack={() => tag()?.goBack()}
				onForward={() => tag()?.goForward()}
				onReload={() => tag()?.reload()}
				onNavigate={(v) => tag()?.loadURL(normalizeUrl(v))}
				onOpenDevtools={() => tag()?.openDevTools()}
				onDeviceChange={setDevice}
				onTogglePicker={onTogglePicker}
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
			{/* "동일하게 카피 기능이 있으며 우리는 현재 메인태스크에 보낼 수 있도록해줘 — 즉시 전송이
			    아니라 명령을 함께" — 요소를 집으면 뜨는 칩+컴포저. ControlPane의 떠 있는 pill 컴포저와
			    같은 톤(§ BrowserPane.module.css). */}
			{pickedElement && (
				<div className={styles.pickerBar}>
					<div className={styles.chip}>
						<span className={styles.chipTag}>{`<${pickedElement.tag}>`}</span>
						<span className={styles.chipText}>{pickedElement.text || pickedElement.selector}</span>
						<button type="button" className={styles.chipClear} onClick={() => setPickedElement(null)} title={tp('선택 해제')}>
							×
						</button>
					</div>
					<div className={styles.composer}>
						<button type="button" className={styles.copyBtn} onClick={handleCopy} title={tp('복사')}>
							{copied ? tp('복사됨') : COPY_ICON}
						</button>
						<textarea
							className={styles.textarea}
							value={instruction}
							onChange={(e) => setInstruction(e.target.value)}
							placeholder={folderId ? tp('이 요소로 뭘 할지 지시…') : tp('이 태스크엔 아직 메인 태스크(지휘자)가 없습니다')}
							disabled={!folderId}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault()
									handleSend()
								}
							}}
						/>
						<button type="button" className={styles.sendBtn} disabled={!folderId || !instruction.trim() || sending} onClick={handleSend} title={tp('메인 태스크로 전송 (Enter)')}>
							{SEND_ICON}
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
