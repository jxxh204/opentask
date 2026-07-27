export default function HmrFlashOverlay({ show }: { show: boolean }) {
	if (!show) return null
	return (
		<div style={{ position: 'absolute', inset: 0, zIndex: 15, pointerEvents: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 26, background: 'rgba(63,185,80,.06)', boxShadow: 'inset 0 0 0 2px rgba(63,185,80,.5)' }}>
			<span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 13px', borderRadius: 20, background: 'rgba(15,21,28,.92)', border: '1px solid var(--green)', backdropFilter: 'blur(6px)' }}>
				<span style={{ width: 12, height: 12, border: '2px solid var(--green)', borderRightColor: 'transparent', borderRadius: '50%', animation: 'spin .6s linear infinite' }} />
				<span className="m" style={{ fontSize: 10.5, color: '#7fe0a0' }}>
					HMR · 프리뷰 갱신 중
				</span>
			</span>
		</div>
	)
}
