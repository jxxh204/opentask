import type { Thread } from '../../store/useDebugStore'

const PHASE_LABEL: Record<Thread['phase'], string> = { working: '작업 중', reloading: '프리뷰 갱신 중', done: '완료' }
const PHASE_COLOR: Record<Thread['phase'], string> = { working: 'var(--violet)', reloading: 'var(--amber)', done: 'var(--green)' }

export default function ThreadRow({ thread, onOpen }: { thread: Thread; onOpen(): void }) {
	const color = PHASE_COLOR[thread.phase]
	return (
		<div onClick={onOpen} style={{ display: 'flex', alignItems: 'center', gap: 9, borderRadius: 9, background: 'var(--card2)', border: '1px solid var(--line2)', padding: '9px 11px', cursor: 'pointer' }}>
			{thread.phase !== 'done' ? (
				<span style={{ width: 12, height: 12, border: `2px solid ${color}`, borderRightColor: 'transparent', borderRadius: '50%', animation: 'spin .6s linear infinite', flex: 'none' }} />
			) : (
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
					<path d="M5 13l4 4L19 7" />
				</svg>
			)}
			<div style={{ minWidth: 0, flex: 1 }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
					<span style={{ fontSize: 10, fontWeight: 700, color }}>{PHASE_LABEL[thread.phase]}</span>
					{thread.diff && (
						<span className="m" style={{ fontSize: 9.5, color: 'var(--green)' }}>
							{thread.diff}
						</span>
					)}
				</div>
				<div className="m" style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
					{thread.cmd}
				</div>
			</div>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
				<path d="M9 6l6 6-6 6" />
			</svg>
		</div>
	)
}
