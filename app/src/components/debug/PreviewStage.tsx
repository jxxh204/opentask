import { useDebugStore } from '../../store/useDebugStore'
import { screenshotUrl } from '../../api/debug'
import HmrFlashOverlay from './HmrFlashOverlay'

const VIEWPORT = { pc: { w: 1280, h: 800 }, webview: { w: 390, h: 844 } }

// Mockup browser/phone chrome is the pre-connect placeholder; once a session
// is live, the inner content area becomes a real polled screenshot from
// Playwright (see plan §Phase 4b — screenshot polling was the deliberate
// simplification vs. full CDP screencast).
export default function PreviewStage() {
	const device = useDebugStore((s) => s.device)
	const route = useDebugStore((s) => s.route)
	const hmr = useDebugStore((s) => s.hmr)
	const target = useDebugStore((s) => s.target)
	const sessionId = useDebugStore((s) => s.sessionId)
	const screenshotNonce = useDebugStore((s) => s.screenshotNonce)
	const selecting = useDebugStore((s) => s.selecting)
	const inspectAtCoord = useDebugStore((s) => s.inspectAtCoord)
	const openDrawerTab = useDebugStore((s) => s.openDrawerTab)

	const vp = VIEWPORT[device]

	const handleClick = (e: React.MouseEvent<HTMLImageElement>) => {
		if (!selecting || !sessionId) return
		const img = e.currentTarget
		const rect = img.getBoundingClientRect()
		const x = Math.round(((e.clientX - rect.left) / rect.width) * vp.w)
		const y = Math.round(((e.clientY - rect.top) / rect.height) * vp.h)
		inspectAtCoord(x, y)
		openDrawerTab('element')
	}

	return (
		<div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
			<div style={{ position: 'absolute', inset: 0, padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				{device === 'pc' ? (
					<div style={{ width: '100%', height: '100%', maxWidth: 1180, borderRadius: 12, background: '#fff', overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column' }}>
						<div style={{ height: 38, flex: 'none', display: 'flex', alignItems: 'center', gap: 7, padding: '0 14px', background: '#f4f2ec', borderBottom: '1px solid rgba(20,20,15,.08)' }}>
							<span style={{ width: 11, height: 11, borderRadius: '50%', background: '#e0524a' }} />
							<span style={{ width: 11, height: 11, borderRadius: '50%', background: '#e3b341' }} />
							<span style={{ width: 11, height: 11, borderRadius: '50%', background: '#3fb950' }} />
							<span className="m" style={{ fontSize: 11, color: '#8b94a0', marginLeft: 8 }}>
								{sessionId ? target.server : `localhost:3000/${route}`}
							</span>
						</div>
						<div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#fff' }}>
							{sessionId ? (
								<img
									key={screenshotNonce}
									src={screenshotUrl(sessionId)}
									onClick={handleClick}
									style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: selecting ? 'crosshair' : 'default' }}
									alt="live preview"
								/>
							) : (
								<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b94a0', fontSize: 12.5 }}>상단에서 디버그 세션을 시작하면 실제 화면이 표시됩니다</div>
							)}
						</div>
					</div>
				) : (
					<div style={{ width: 320, height: '100%', maxHeight: 680, borderRadius: 40, background: '#000', padding: 11, boxShadow: '0 30px 80px rgba(0,0,0,.55)' }}>
						<div style={{ width: '100%', height: '100%', borderRadius: 30, background: '#fff', overflow: 'hidden', position: 'relative' }}>
							{sessionId ? (
								<img
									key={screenshotNonce}
									src={screenshotUrl(sessionId)}
									onClick={handleClick}
									style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: selecting ? 'crosshair' : 'default' }}
									alt="live preview"
								/>
							) : (
								<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b94a0', fontSize: 12, textAlign: 'center', padding: 16 }}>세션 시작 전</div>
							)}
						</div>
					</div>
				)}
			</div>

			<HmrFlashOverlay show={hmr} />

			<div style={{ position: 'absolute', left: 24, bottom: 18, display: 'inline-flex', alignItems: 'center', gap: 8, height: 30, padding: '0 12px', borderRadius: 20, background: 'rgba(15,21,28,.9)', border: '1px solid var(--line2)', backdropFilter: 'blur(6px)' }}>
				<span style={{ width: 7, height: 7, borderRadius: '50%', background: sessionId ? 'var(--green)' : 'var(--t3)' }} />
				<span className="m" style={{ fontSize: 10.5, color: 'var(--t2)' }}>
					{sessionId ? `${target.worktree} → ${target.server} 연결됨` : '세션 미연결'}
				</span>
			</div>
		</div>
	)
}
