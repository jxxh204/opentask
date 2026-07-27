import { useDebugStore } from '../../store/useDebugStore'
import Modal from '../common/Modal'
import DiffView from './DiffView'

const PHASE_LABEL: Record<string, string> = { working: '작업 중', reloading: '프리뷰 갱신 중', done: '완료' }

export default function ThreadResultModal() {
	const modalThreadId = useDebugStore((s) => s.modalThreadId)
	const threads = useDebugStore((s) => s.threads)
	const modalTab = useDebugStore((s) => s.modalTab)
	const setModalTab = useDebugStore((s) => s.setModalTab)
	const closeModal = useDebugStore((s) => s.closeModal)
	const followUp = useDebugStore((s) => s.followUp)
	const setFollowUp = useDebugStore((s) => s.setFollowUp)
	const sendFollowUp = useDebugStore((s) => s.sendFollowUp)

	const thread = threads.find((t) => t.id === modalThreadId) ?? null

	return (
		<Modal open={!!thread} onClose={closeModal} width={640}>
			{thread && (
				<>
					<div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 18px', borderBottom: '1px solid var(--line)' }}>
						{thread.phase !== 'done' ? (
							<span style={{ width: 13, height: 13, border: '2px solid var(--violet)', borderRightColor: 'transparent', borderRadius: '50%', animation: 'spin .6s linear infinite', flex: 'none' }} />
						) : (
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth={2.4}>
								<path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						)}
						<span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{PHASE_LABEL[thread.phase]}</span>
						<span className="m" style={{ fontSize: 10, color: 'var(--t3)' }}>
							{thread.ellabel}
						</span>
						<div style={{ flex: 1 }} />
						<button style={{ height: 28, padding: '0 11px', borderRadius: 8, background: 'var(--card2)', border: '1px solid var(--line2)', cursor: 'pointer', color: 'var(--t2)', fontSize: 11, fontWeight: 600 }} onClick={closeModal}>
							개발실에서 열기
						</button>
						<button style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--card2)', border: '1px solid var(--line2)', cursor: 'pointer', color: 'var(--t2)', fontSize: 14 }} onClick={closeModal}>
							✕
						</button>
					</div>

					<div style={{ flex: 'none', display: 'flex', gap: 2, padding: '0 14px', borderBottom: '1px solid var(--line)' }}>
						<button onClick={() => setModalTab('reply')} style={{ height: 38, padding: '0 13px', background: 'none', border: 'none', borderBottom: `2px solid ${modalTab === 'reply' ? 'var(--violet)' : 'transparent'}`, cursor: 'pointer', color: modalTab === 'reply' ? 'var(--ink)' : 'var(--t3)', fontSize: 12, fontWeight: 700 }}>
							답변
						</button>
						<button onClick={() => setModalTab('diff')} style={{ height: 38, padding: '0 13px', background: 'none', border: 'none', borderBottom: `2px solid ${modalTab === 'diff' ? 'var(--violet)' : 'transparent'}`, cursor: 'pointer', color: modalTab === 'diff' ? 'var(--ink)' : 'var(--t3)', fontSize: 12, fontWeight: 700 }}>
							변경 diff {thread.diff && <span className="m" style={{ fontSize: 9.5, color: 'var(--green)' }}>{thread.diff}</span>}
						</button>
					</div>

					<div className="scroll-y" style={{ flex: 1, minHeight: 0, padding: '16px 18px' }}>
						{modalTab === 'reply' ? (
							<>
								<div style={{ display: 'flex', gap: 9, marginBottom: 14 }}>
									<span style={{ width: 24, height: 24, borderRadius: 7, background: 'rgba(155,130,232,.15)', color: 'var(--violet)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flex: 'none' }}>나</span>
									<div style={{ background: 'var(--card2)', border: '1px solid var(--line2)', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: 'var(--ink)', lineHeight: 1.5 }}>{thread.cmd}</div>
								</div>
								{thread.reply && (
									<div style={{ display: 'flex', gap: 9 }}>
										<span style={{ width: 24, height: 24, borderRadius: 7, background: 'rgba(87,157,255,.14)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
												<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
											</svg>
										</span>
										<div style={{ minWidth: 0, flex: 1 }}>
											<div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{thread.reply}</div>
											{thread.files.length > 0 && (
												<div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
													{thread.files.map((f) => (
														<span key={f} className="m" style={{ fontSize: 10, color: 'var(--t2)', background: 'var(--card2)', border: '1px solid var(--line2)', borderRadius: 6, padding: '3px 8px' }}>
															{f}
														</span>
													))}
												</div>
											)}
										</div>
									</div>
								)}
								{thread.phase !== 'done' && !thread.reply && (
									<div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--t3)', fontSize: 11.5, marginTop: 6 }}>
										<span style={{ width: 12, height: 12, border: '2px solid var(--violet)', borderRightColor: 'transparent', borderRadius: '50%', animation: 'spin .6s linear infinite' }} />
										{thread.log}
									</div>
								)}
							</>
						) : (
							<DiffView diff={thread.diff} spin={thread.phase !== 'done'} />
						)}
					</div>

					<div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
						<input
							value={followUp}
							onChange={(e) => setFollowUp(e.target.value)}
							onKeyDown={(e) => e.key === 'Enter' && sendFollowUp()}
							placeholder="후속 지시… (같은 스레드로 이어집니다)"
							style={{ flex: 1, height: 38, padding: '0 12px', borderRadius: 9, background: 'var(--card2)', border: '1px solid var(--line2)', color: 'var(--ink)', fontSize: 12, outline: 'none' }}
						/>
						<button onClick={sendFollowUp} style={{ height: 38, padding: '0 16px', borderRadius: 9, background: 'var(--violet)', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700 }}>
							전송
						</button>
					</div>
				</>
			)}
		</Modal>
	)
}
