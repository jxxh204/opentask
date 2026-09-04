import { useEffect, useMemo, useRef, useState } from 'react'
import { useSessionsStore } from '../../store/useSessionsStore'
import { useTabsStore } from '../../store/useTabsStore'
import Modal from '../common/Modal'
import { useT } from '../../utils/i18n'
import styles from './CommandPalette.module.css'

type Entry = { key: string; label: string; sub?: string; go(): void }

// "명령팔레트(Cmd+K)로 어디서든 태스크/탭 검색해서 바로 이동" — VSCode/Linear류의 Cmd+K 관례. 사이드바
// 검색(§ SessionShell.tsx sidebarQuery)과 같은 단순 부분일치를 그대로 쓴다 — 새 퍼지매치 라이브러리를
// 끌어올 만큼 목록이 크지 않다(폴더+태스크+메모 다 합쳐도 수십~백여 개 수준).
export default function CommandPalette({ open, onClose }: { open: boolean; onClose(): void }) {
	const t = useT()
	const folders = useSessionsStore((s) => s.folders)
	const inbox = useSessionsStore((s) => s.inbox)
	const notes = useSessionsStore((s) => s.notes)
	const [query, setQuery] = useState('')
	const [activeIdx, setActiveIdx] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)
	const listRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (open) {
			setQuery('')
			setActiveIdx(0)
			// Modal이 마운트되는 바로 이 프레임엔 아직 DOM에 없을 수 있어 한 틱 늦춘다.
			requestAnimationFrame(() => inputRef.current?.focus())
		}
	}, [open])

	const entries = useMemo<Entry[]>(() => {
		const list: Entry[] = []
		for (const f of folders) {
			list.push({
				key: `folder:${f.id}`,
				label: f.name,
				go: () => useTabsStore.getState().setActiveNode(f.id, 'orchestrator'),
			})
			for (const task of f.tasks) {
				list.push({
					key: `task:${task.id}`,
					label: task.name,
					sub: f.name,
					go: () => useTabsStore.getState().setActiveNode(task.id, 'terminal'),
				})
			}
		}
		for (const task of inbox) {
			list.push({ key: `task:${task.id}`, label: task.name, go: () => useTabsStore.getState().setActiveNode(task.id, 'terminal') })
		}
		for (const n of notes) {
			list.push({ key: `note:${n.id}`, label: n.name, sub: t('메모'), go: () => useSessionsStore.getState().openNoteDetail(n.id) })
		}
		return list
	}, [folders, inbox, notes, t])

	const q = query.trim().toLowerCase()
	const filtered = q ? entries.filter((e) => e.label.toLowerCase().includes(q) || e.sub?.toLowerCase().includes(q)) : entries

	function select(entry: Entry) {
		entry.go()
		onClose()
	}

	function onKeyDown(e: React.KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault()
			setActiveIdx((i) => Math.min(i + 1, filtered.length - 1))
		} else if (e.key === 'ArrowUp') {
			e.preventDefault()
			setActiveIdx((i) => Math.max(i - 1, 0))
		} else if (e.key === 'Enter') {
			e.preventDefault()
			if (filtered[activeIdx]) select(filtered[activeIdx])
		} else if (e.key === 'Escape') {
			onClose()
		}
	}

	return (
		<Modal open={open} onClose={onClose} width={560}>
			<div className={styles.wrap}>
				<input
					ref={inputRef}
					className={styles.input}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value)
						setActiveIdx(0)
					}}
					onKeyDown={onKeyDown}
					placeholder={t('태스크·서브태스크·메모 검색…')}
				/>
				<div className={styles.list} ref={listRef}>
					{filtered.length === 0 ? (
						<div className={styles.empty}>{t('결과 없음')}</div>
					) : (
						filtered.slice(0, 50).map((entry, i) => (
							<div key={entry.key} className={`${styles.item} ${i === activeIdx ? styles.itemActive : ''}`} onMouseEnter={() => setActiveIdx(i)} onClick={() => select(entry)}>
								{entry.sub && <span className={styles.itemSub}>{entry.sub}</span>}
								<span className={styles.itemLabel}>{entry.label}</span>
							</div>
						))
					)}
				</div>
			</div>
		</Modal>
	)
}
