import { useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '../../store/useSessionsStore'
import type { UiBlock } from '../../store/types'
import { askControl, UI_BLOCK_EDIT_MARKER } from '../../api/control'
import { useT, useTp } from '../../utils/i18n'
import styles from './TaskDetailModal.module.css'

// "하이브마인드가 서브태스크에 원한다면 ui를 추가할 수 있으면 좋겠어. json형태로 mapping하고 하이브
// 마인드가 json을 건드리면..." — 서브태스크.ui_blocks(§ store/types.ts UiBlock)를 닫힌 블록 타입
// 화이트리스트로만 렌더한다. report_html(§ v25)과 달리 여기는 SubtaskDetailPanel 안, 즉 신뢰된 DOM에
// 바로 꽂히는 자리라 HTML/JS는 절대 안 받는다.
//
// "직접 가능하지만 하이브마인드도 알아야함" — 체크박스는 사람이 바로 토글 가능(같은 update_subtask
// 경로를 하이브마인드와 공유). 클릭할 때마다 바로 찌르면 5개 연달아 누를 때 하이브마인드가 5번
// 인터럽트당하니, 서브태스크당 하나의 debounce 타이머로 묶어 조용해진 뒤 한 번만 짧게 알린다 — 세부
// diff를 다 실어보내는 대신 "바뀌었으니 확인해봐" 정도로 짧게, 나머지는 하이브마인드가 필요하면
// list_tasks로 직접 조회한다.
const NOTIFY_DEBOUNCE_MS = 4000

export default function SubtaskUiBlocks({ subtaskId, subtaskName, blocks }: { subtaskId: string; subtaskName: string; blocks: UiBlock[] }) {
	const t = useT()
	const tp = useTp()
	const updateSubtaskUiBlocks = useSessionsStore((s) => s.updateSubtaskUiBlocks)
	const notifyTimer = useRef<number | null>(null)
	const [sending, setSending] = useState(false)

	useEffect(() => {
		return () => {
			if (notifyTimer.current !== null) window.clearTimeout(notifyTimer.current)
		}
	}, [])

	if (!blocks.length) return null

	function scheduleNotify() {
		if (notifyTimer.current !== null) window.clearTimeout(notifyTimer.current)
		notifyTimer.current = window.setTimeout(() => {
			notifyTimer.current = null
			askControl(`${UI_BLOCK_EDIT_MARKER} 서브태스크 "${subtaskName}"의 UI 블록을 사람이 방금 바꿨습니다 — 확인해보세요.`).catch(() => {})
		}, NOTIFY_DEBOUNCE_MS)
	}

	function toggleChecklistItem(blockIndex: number, itemId: string) {
		const next = blocks.map((b, i) => {
			if (i !== blockIndex || b.type !== 'checklist') return b
			return { ...b, items: b.items.map((it) => (it.id === itemId ? { ...it, checked: !it.checked } : it)) }
		})
		updateSubtaskUiBlocks(subtaskId, next)
		scheduleNotify()
	}

	async function pressButton(block: Extract<UiBlock, { type: 'button' }>) {
		setSending(true)
		try {
			await askControl(block.prompt)
		} finally {
			setSending(false)
		}
	}

	return (
		<div className={styles.uiBlocksSection}>
			{blocks.map((block, i) => {
				if (block.type === 'checklist') {
					const done = block.items.filter((it) => it.checked).length
					return (
						<div key={i} className={styles.briefCard}>
							<div className={styles.uiBlockTitle}>{block.title ? tp('{title} — {done}/{total}', { title: block.title, done, total: block.items.length }) : tp('체크리스트 — {done}/{total}', { done, total: block.items.length })}</div>
							{block.items.map((it) => (
								<label key={it.id} className={styles.uiChecklistItem}>
									<input type="checkbox" className={styles.uiChecklistCheckbox} checked={it.checked} onChange={() => toggleChecklistItem(i, it.id)} />
									<span className={`${styles.uiChecklistLabel} ${it.checked ? styles.uiChecklistLabelDone : ''}`}>{it.label}</span>
								</label>
							))}
						</div>
					)
				}
				if (block.type === 'table') {
					return (
						<div key={i} className={styles.briefCard}>
							{block.title && <div className={styles.uiBlockTitle}>{block.title}</div>}
							<div className={styles.uiTableWrap}>
								<table className={styles.uiTable}>
									<thead>
										<tr>
											{block.headers.map((h, hi) => (
												<th key={hi}>{h}</th>
											))}
										</tr>
									</thead>
									<tbody>
										{block.rows.map((row, ri) => (
											<tr key={ri}>
												{row.map((cell, ci) => (
													<td key={ci}>{cell}</td>
												))}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)
				}
				if (block.type === 'kv') {
					return (
						<div key={i} className={styles.briefCard}>
							{block.title && <div className={styles.uiBlockTitle}>{block.title}</div>}
							{block.pairs.map((p, pi) => (
								<div key={pi} className={styles.uiKvRow}>
									<span className={styles.uiKvKey}>{p.key}</span>
									<span className={styles.uiKvValue}>{p.value}</span>
								</div>
							))}
						</div>
					)
				}
				// block.type === 'button'
				return (
					<button key={i} type="button" className={styles.uiBlockButton} disabled={sending} onClick={() => pressButton(block)}>
						{sending ? t('전송 중…') : block.label}
					</button>
				)
			})}
		</div>
	)
}
