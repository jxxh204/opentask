import { useSessionsStore } from '../../store/useSessionsStore'
import { detectLink, LINK_LABEL } from '../../utils/linkDetect'

export default function TaskComposer() {
	const draft = useSessionsStore((s) => s.draft)
	const setDraft = useSessionsStore((s) => s.setDraft)
	const addTaskFromDraft = useSessionsStore((s) => s.addTaskFromDraft)
	const kind = detectLink(draft)

	return (
		<div style={{ maxWidth: 900, margin: '0 auto' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 46, padding: '0 8px 0 14px', borderRadius: 12, background: 'var(--card)', border: `1px solid ${draft.trim() ? 'var(--violet)' : 'var(--line2)'}` }}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth={2} strokeLinecap="round">
					<path d="M12 5v14M5 12h14" />
				</svg>
				<input
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter') addTaskFromDraft()
					}}
					placeholder="태스크 추가 — 제목을 쓰거나 Figma·스레드·Notion·PR 링크를 붙여넣기"
					style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--ink)', fontSize: 13 }}
				/>
				{kind && (
					<span className="m" style={{ fontSize: 10, fontWeight: 700, color: 'var(--blue)', background: 'rgba(87,157,255,.14)', borderRadius: 6, padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
						{LINK_LABEL[kind]}
					</span>
				)}
				<button
					onClick={addTaskFromDraft}
					style={{ height: 32, padding: '0 14px', borderRadius: 9, background: 'var(--violet)', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700 }}
				>
					추가
				</button>
			</div>
			<div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 7, paddingLeft: 4 }}>
				새 태스크는 <b style={{ color: 'var(--t2)' }}>미분류</b>에 담깁니다 · 붙여넣은 링크는 자동으로 종류(피그마·스레드·노션·PR)를 인식해 태스크에 첨부
			</div>
		</div>
	)
}
