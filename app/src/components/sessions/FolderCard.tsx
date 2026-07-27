import { useState } from 'react'
import type { Folder } from '../../store/types'
import { useSessionsStore } from '../../store/useSessionsStore'
import TaskRow from './TaskRow'
import OrchestratorBar from './OrchestratorBar'
import styles from './FolderCard.module.css'

export default function FolderCard({ folder }: { folder: Folder }) {
	const open = useSessionsStore((s) => s.openFolders[folder.id] !== false)
	const toggleFolder = useSessionsStore((s) => s.toggleFolder)
	const renameFolder = useSessionsStore((s) => s.renameFolder)
	const overFolderId = useSessionsStore((s) => s.overFolderId)
	const setOverFolder = useSessionsStore((s) => s.setOverFolder)
	const dragTaskId = useSessionsStore((s) => s.dragTaskId)
	const moveTask = useSessionsStore((s) => s.moveTask)
	const [name, setName] = useState(folder.name)

	const isOver = overFolderId === folder.id
	const border = isOver ? 'var(--violet)' : 'var(--line)'
	const bg = isOver ? 'var(--vtint)' : 'var(--card)'

	return (
		<div
			className={styles.card}
			style={{ border: `1px solid ${border}`, background: bg }}
			onDragOver={(e) => {
				e.preventDefault()
				if (overFolderId !== folder.id) setOverFolder(folder.id)
			}}
			onDrop={(e) => {
				e.preventDefault()
				if (dragTaskId) moveTask(dragTaskId, folder.id)
			}}
		>
			<div className={styles.head} onClick={() => toggleFolder(folder.id)}>
				<svg className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
					<path d="M9 6l6 6-6 6" />
				</svg>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
					<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
				</svg>
				<input
					className={`m ${styles.nameInput}`}
					value={name}
					onClick={(e) => e.stopPropagation()}
					onChange={(e) => setName(e.target.value)}
					onBlur={() => name.trim() && name !== folder.name && renameFolder(folder.id, name.trim())}
				/>
				<span className={`m ${styles.count}`}>{folder.tasks.length}</span>
				<div style={{ flex: 1 }} />
				<span className={`m ${styles.base}`}>{folder.base}</span>
			</div>
			{open && (
				<div>
					<div style={{ padding: '11px 14px', borderTop: '1px solid var(--line)' }}>
						<OrchestratorBar folderId={folder.id} taskCount={folder.tasks.length} />
					</div>
					<div className={styles.body}>
						{folder.tasks.map((t) => (
							<TaskRow
								key={t.id}
								task={t}
								folderBase={folder.base}
								dragBeforeTaskId={(e) => {
									e.preventDefault()
									e.stopPropagation()
									if (dragTaskId) moveTask(dragTaskId, folder.id, t.id)
								}}
							/>
						))}
						{folder.tasks.length === 0 && <div className={styles.emptyDrop}>여기로 태스크를 드래그</div>}
					</div>
				</div>
			)}
		</div>
	)
}
