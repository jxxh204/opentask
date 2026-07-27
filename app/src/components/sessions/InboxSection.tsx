import type { Task } from '../../store/types'
import { useSessionsStore } from '../../store/useSessionsStore'
import TaskRow from './TaskRow'

export default function InboxSection({ tasks }: { tasks: Task[] }) {
	const overFolderId = useSessionsStore((s) => s.overFolderId)
	const setOverFolder = useSessionsStore((s) => s.setOverFolder)
	const dragTaskId = useSessionsStore((s) => s.dragTaskId)
	const moveTask = useSessionsStore((s) => s.moveTask)

	const isOver = overFolderId === 'inbox'

	return (
		<div
			style={{ border: `1px dashed ${isOver ? 'var(--violet)' : 'var(--line2)'}`, borderRadius: 13, background: isOver ? 'var(--vtint)' : 'transparent', overflow: 'hidden' }}
			onDragOver={(e) => {
				e.preventDefault()
				if (overFolderId !== 'inbox') setOverFolder('inbox')
			}}
			onDrop={(e) => {
				e.preventDefault()
				if (dragTaskId) moveTask(dragTaskId, null)
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--t2)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
					<path d="M3 12h5l2 3h4l2-3h5" />
					<path d="M4 12 6 5h12l2 7v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
				</svg>
				<span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>미분류</span>
				<span className="m" style={{ fontSize: 10, fontWeight: 700, color: tasks.length > 0 ? 'var(--amber)' : 'var(--t3)', background: tasks.length > 0 ? 'rgba(224,164,54,.14)' : 'var(--line2)', borderRadius: 6, padding: '2px 8px' }}>
					{tasks.length}
				</span>
				<span style={{ fontSize: 11, color: 'var(--t3)' }}>폴더 없는 태스크 · 드래그해 분류</span>
			</div>
			{tasks.length > 0 && (
				<div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
					{tasks.map((t) => (
						<TaskRow
							key={t.id}
							task={t}
							folderBase={null}
							dragBeforeTaskId={(e) => {
								e.preventDefault()
								e.stopPropagation()
								if (dragTaskId) moveTask(dragTaskId, null, t.id)
							}}
						/>
					))}
				</div>
			)}
		</div>
	)
}
