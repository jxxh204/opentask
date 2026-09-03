import { useEffect, useState } from 'react'
import { useSessionsStore, openTaskOrFolderDetail } from '../../store/useSessionsStore'
import { useTabsStore } from '../../store/useTabsStore'
import { useBrowserNavStore } from '../../store/useBrowserNavStore'
import { getSubtaskWorkState, stopSubtaskSession } from '../../api/sessions'
import type { SubtaskWorkStatus } from '../../api/sessions'
import { addBusinessDays } from '../../utils/businessDays'
import { extractLinks } from '../../utils/extractLinks'
import { useT, useTp } from '../../utils/i18n'
import LinkBriefSection from './LinkBriefSection'
import CodeBriefSection from './CodeBriefSection'
import styles from './TaskDetailModal.module.css'

function pad(n: number) {
	return String(n).padStart(2, '0')
}
function msToDateInputValue(ms: number) {
	const d = new Date(ms)
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function dateInputValueToMs(v: string) {
	const [y, m, d] = v.split('-').map(Number)
	return new Date(y, m - 1, d).getTime()
}
function toGCalDate(ms: number) {
	const d = new Date(ms)
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}
// "각 서브 태스크에 구글 캘린더 등록 기능이 있으면좋겠어. 다만 ux를 해치지 않는 선에서" — OAuth
// 연동(토큰 저장·리프레시)은 이 앱에 아예 없는 인프라를 새로 만들어야 해서 요청 취지("UX 해치지
// 않는 선")를 넘어선다. 대신 크리덴셜 없이 구글 캘린더 자신의 "이벤트 만들기" 화면을 새 창으로
// 여는 URL 템플릿(action=TEMPLATE)만 만든다 — 클릭한 사람이 그 화면에서 직접 저장을 눌러야 실제
// 캘린더에 들어간다(서버가 대신 아무것도 안 함, 이 앱은 구글 계정을 아예 모른다). 날짜는 예정일이
// 있을 때만 의미가 있어 그때만 뜬다. 종일 일정 형식(dates=시작/종료, 둘 다 YYYYMMDD)의 종료일은
// 구글 쪽 규약상 배타적(그 날짜 자체는 포함 안 됨)이라, 실제 마지막 날(addBusinessDays가 돌려주는
// 영업일 기준 종료일 — TaskDetailPanel의 "~ N월 N일 종료" 표시와 같은 계산)에 하루를 더한다.
function googleCalendarUrl(subtask: { name: string; desc: string; due_date: number | null; duration_days: number | null }, parentTaskName: string) {
	if (!subtask.due_date) return null
	const lastDay = new Date(addBusinessDays(subtask.due_date, subtask.duration_days || 1))
	const endExclusive = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1)
	const params = new URLSearchParams({
		action: 'TEMPLATE',
		text: `${parentTaskName} — ${subtask.name}`,
		dates: `${toGCalDate(subtask.due_date)}/${toGCalDate(endExclusive.getTime())}`,
	})
	if (subtask.desc) params.set('details', subtask.desc)
	return `https://calendar.google.com/calendar/render?${params.toString()}`
}

// "서브태스크를 누르면 해당 서브태스크의 내용만 보이게" — 부모 태스크 전체를 담은 TaskDetailModal과
// 별개로, 서브태스크 하나만을 위한 드로어. 같은 슬라이드인 셰이프(TaskDetailModal.module.css 재사용)
// 를 쓰되 내용은 이 서브태스크 자신의 이름/설명/예정일/기간 + 지금 세션 상태로 좁힌다. 상단의
// "메인 태스크: X"를 누르면 이 패널을 닫고 그 태스크의 다이어그램 탭으로 넘어가 전체 체인을 보여준다.
export default function SubtaskDetailPanel({ subtaskId, parentTaskId, onClose }: { subtaskId: string | null; parentTaskId: string | null; onClose(): void }) {
	const t = useT()
	const tp = useTp()
	const open = !!subtaskId && !!parentTaskId
	const parentTask = useSessionsStore((s) => {
		if (!parentTaskId) return null
		return s.inbox.find((t) => t.id === parentTaskId) ?? s.folders.flatMap((f) => f.tasks).find((t) => t.id === parentTaskId) ?? null
	})
	const parentFolderId = useSessionsStore((s) => {
		if (!parentTaskId) return null
		const f = s.folders.find((f) => f.tasks.some((t) => t.id === parentTaskId))
		return f ? f.id : null
	})
	const updateSubtaskName = useSessionsStore((s) => s.updateSubtaskName)
	const updateSubtaskDesc = useSessionsStore((s) => s.updateSubtaskDesc)
	const updateSubtaskDueDate = useSessionsStore((s) => s.updateSubtaskDueDate)
	const updateSubtaskDuration = useSessionsStore((s) => s.updateSubtaskDuration)
	const setSubtaskDone = useSessionsStore((s) => s.setSubtaskDone)
	const quickStartTask = useSessionsStore((s) => s.quickStartTask)

	const subtask = parentTask?.subtasks.find((st) => st.id === subtaskId) ?? null
	const descLinks = subtask ? extractLinks(subtask.desc) : []

	const [work, setWork] = useState<SubtaskWorkStatus | null>(null)
	const [busy, setBusy] = useState(false)
	useEffect(() => {
		if (!open || !parentTaskId || !subtaskId) return
		let cancelled = false
		async function poll() {
			const r = await getSubtaskWorkState(parentTaskId!)
			if (!cancelled && r.ok) setWork(r.subtasks.find((x) => x.id === subtaskId) ?? null)
		}
		poll()
		const id = window.setInterval(poll, 5000)
		return () => {
			cancelled = true
			window.clearInterval(id)
		}
	}, [open, parentTaskId, subtaskId])

	function goToMainTask() {
		if (!parentFolderId) return
		onClose()
		useTabsStore.getState().setActiveNode(parentFolderId, 'orchestrator')
		useTabsStore.getState().openOrFocusTab(parentFolderId, 'detail')
	}

	// "메인태스크가 없는건 승격 기능을 넣고... 승격되면 상세 UI도 메인태스크 UI로 변경되어야하고" —
	// 이 서브태스크의 부모가 아직 일감함에 머물러(폴더로 승격 전) 다이어그램이 없을 때 그 자리에서
	// 바로 승격시키고("시작" 버튼과 같은 quickStartTask), 성공하면 이 서브태스크 패널은 닫고 "메인
	// 태스크는 이제 사이드바에서 상세페이지를 띄우지말고 탭으로" — 이제 진짜 메인 태스크가 된 그
	// 태스크의 탭(태스크 매니저/다이어그램)으로 이동한다(TaskDetailModal 드로어 아님).
	const [promoting, setPromoting] = useState(false)
	async function promoteMainTask() {
		if (!parentTaskId) return
		setPromoting(true)
		try {
			await quickStartTask(parentTaskId)
			onClose()
			openTaskOrFolderDetail(parentTaskId)
		} finally {
			setPromoting(false)
		}
	}

	// "서브태스크의 클로드 세션에 접속하는 루트가 적어" — 이 패널은 상태(진행 중/세션 종료됨)만 보여줄 뿐
	// 실제 세션(SubtaskSessionPane)으로 가는 길이 없었다. 유일한 경로는 "다이어그램" 탭에서 서브태스크
	// 박스를 직접 찾아 눌러야 했는데(§ TaskManagerBoard), 정작 서브태스크를 처음 살펴보는 자리인 이
	// 패널(사이드바 subChain 클릭)엔 그 링크가 없었다. openSubtaskTab은 TaskManagerBoard와 동일 — 메인
	// 태스크(폴더) 탭 목록에 세션 탭을 추가/포커스하고, setActiveNode로 그 폴더 워크스페이스로 전환한다.
	function openSession() {
		if (!parentFolderId || !subtaskId || !parentTaskId || !subtask) return
		useTabsStore.getState().openSubtaskTab(parentFolderId, subtaskId, parentTaskId, subtask.name)
		useTabsStore.getState().setActiveNode(parentFolderId, 'orchestrator')
		onClose()
	}

	// "이 html파일은 해당 서브태스크 상세에서 계속 볼 수 있도록해줘" — 완료된 서브태스크 세션이
	// 스스로 작성해 저장한 HTML 리포트(§ orchestrator.cjs advanceSubtaskWork)를 내부 브라우저로
	// 연다. openSession과 같은 openOrFocusTab 스코프(parentFolderId)를 쓰되 탭 종류는 'browser' —
	// 이미 있는 "탭 열고 URL로 이동시키기" 관례(§ XTerm.tsx WebLinksAddon, SessionShell.tsx openDevServer).
	function openReport() {
		if (!parentFolderId || !work?.reportUrl) return
		const port = window.location.port || '18771'
		useTabsStore.getState().openOrFocusTab(parentFolderId, 'browser')
		useBrowserNavStore.getState().request(parentFolderId, `http://localhost:${port}${work.reportUrl}`)
		onClose()
	}

	async function stopSession() {
		if (!subtaskId) return
		setBusy(true)
		try {
			await stopSubtaskSession(subtaskId)
			const r = await getSubtaskWorkState(parentTaskId!)
			if (r.ok) setWork(r.subtasks.find((x) => x.id === subtaskId) ?? null)
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className={styles.overlay} style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }} onClick={onClose}>
			<div className={styles.drawer} style={{ transform: open ? 'translateX(0)' : 'translateX(100%)' }} onClick={(e) => e.stopPropagation()}>
				{subtask && parentTask && (
					<>
						<div className={styles.head}>
							<input
								className={styles.nameInput}
								style={subtask.completed_at ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}
								value={subtask.name}
								onChange={(e) => updateSubtaskName(subtask.id, e.target.value)}
								onBlur={(e) => updateSubtaskName(subtask.id, e.target.value.trim() || subtask.name)}
							/>
							{/* "서브태스크 완료 버튼 필요" — TaskDetailContent.doneToggle과 같은 패턴. 완료해도
							    레코드는 지우지 않고 completed_at만 찍혀 사이드바 subChain 목록에서 사라진다
							    (캘린더엔 그대로 남음, § CalendarPane). */}
							<button
								type="button"
								className={`${styles.doneToggle} ${subtask.completed_at ? styles.doneToggleActive : ''}`}
								onClick={() => setSubtaskDone(subtask.id, !subtask.completed_at)}
								title={t('완료 처리 — 사이드바 목록에서는 사라지고 캘린더에는 남습니다')}
							>
								<span className={styles.doneCheck} />
								{t('완료')}
							</button>
							<button type="button" className={styles.closeBtn} onClick={onClose} title={t('닫기')}>
								×
							</button>
						</div>
						<div className={styles.body}>
							{parentFolderId ? (
								<button type="button" className={mainTaskLinkClass()} onClick={goToMainTask} title={t('메인 태스크 다이어그램으로 이동')}>
									{tp('↰ 메인 태스크: {name}', { name: parentTask.name })}
								</button>
							) : (
								<div className={mainTaskLinkClass()} style={{ justifyContent: 'space-between', cursor: 'default' }}>
									<span>{tp('↰ 메인 태스크: {name}', { name: parentTask.name })}</span>
									<button type="button" className={styles.metaClear} disabled={promoting} onClick={promoteMainTask} title={t('이 메인 태스크를 승격해 오케스트레이션(워크트리·다이어그램)을 시작합니다')}>
										{promoting ? t('승격 중…') : t('승격')}
									</button>
								</div>
							)}

							<div className={styles.metaRow}>
								<span className={styles.metaLabel}>{t('예정일')}</span>
								<input
									type="date"
									className="fin m"
									style={{ width: 150, height: 30 }}
									value={subtask.due_date ? msToDateInputValue(subtask.due_date) : ''}
									onChange={(e) => updateSubtaskDueDate(subtask.id, e.target.value ? dateInputValueToMs(e.target.value) : null)}
								/>
								{subtask.due_date !== null && (
									<>
										<button type="button" className={styles.metaClear} onClick={() => updateSubtaskDueDate(subtask.id, null)}>
											{t('지우기')}
										</button>
										{/* "각 서브 태스크에 구글 캘린더 등록 기능... ux를 해치지 않는 선에서" — 이미 있는
										    "지우기" 텍스트 버튼과 같은 자리·같은 스타일로만 하나 더(§ 위 googleCalendarUrl
										    주석). SessionShell.tsx apiAddress 링크와 같은 관례 — target="_blank"를
										    electron/main.cjs의 setWindowOpenHandler가 가로채 시스템 기본 브라우저로 연다. */}
										<a
											className={styles.metaClear}
											style={{ textDecoration: 'none' }}
											href={googleCalendarUrl(subtask, parentTask.name) ?? undefined}
											target="_blank"
											rel="noreferrer"
											title={t('구글 캘린더에 이 일정 등록')}
										>
											{t('구글 캘린더에 등록')}
										</a>
									</>
								)}
							</div>
							{subtask.due_date !== null && (
								<div className={styles.metaRow}>
									<span className={styles.metaLabel}>{t('기간')}</span>
									<input
										type="number"
										min={1}
										className="fin m"
										style={{ width: 56, height: 30 }}
										placeholder="1"
										value={subtask.duration_days ?? ''}
										onChange={(e) => updateSubtaskDuration(subtask.id, e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null)}
									/>
									<span className={styles.metaHint}>{t('영업일')}</span>
									{subtask.duration_days !== null && subtask.duration_days > 1 && (
										<span className={styles.metaHint}>
											{tp('~ {month}월 {day}일 종료', {
												month: new Date(addBusinessDays(subtask.due_date, subtask.duration_days)).getMonth() + 1,
												day: new Date(addBusinessDays(subtask.due_date, subtask.duration_days)).getDate(),
											})}
										</span>
									)}
								</div>
							)}

							<div className={styles.metaRow} style={{ alignItems: 'center' }}>
								<span className={styles.metaLabel}>{t('세션')}</span>
								{work?.alive ? (
									<>
										<span className={sessionBadgeClass('alive')}>{t('진행 중')}</span>
										{parentFolderId && (
											<button type="button" className={styles.metaClear} onClick={openSession}>
												{t('세션 보기')}
											</button>
										)}
										<button type="button" className={styles.metaClear} disabled={busy} onClick={stopSession}>
											{busy ? t('종료 중…') : t('세션 종료')}
										</button>
									</>
								) : work?.started ? (
									<>
										<span className={sessionBadgeClass('done')}>{t('세션 종료됨')}</span>
										{parentFolderId && (
											<button type="button" className={styles.metaClear} onClick={openSession}>
												{t('세션 보기')}
											</button>
										)}
									</>
								) : (
									<span className={sessionBadgeClass('idle')}>{t('대기')}</span>
								)}
							</div>
							{/* "서브 태스크가 끝나면... 어떻게 끝났고 어떤것들을 했는지 정리해서 보여줬으면해.
							    이 html파일은 해당 서브태스크 상세에서 계속 볼 수 있도록해줘" — alive/started
							    여부와 무관하게 reportUrl이 있으면(완료 시 저장됨) 항상 뜬다. */}
							{work?.reportUrl && (
								<div className={styles.metaRow} style={{ alignItems: 'center' }}>
									<span className={styles.metaLabel}>{t('완료 보고서')}</span>
									<button type="button" className={styles.metaClear} onClick={openReport}>
										{t('보고서 보기')}
									</button>
								</div>
							)}
							{work?.worktreePath && <div className={styles.metaHint}>worktree: {work.worktreePath}</div>}
							{work?.branch && <div className={styles.metaHint}>⎇ {work.branch}</div>}

							<div className={styles.descLabel} style={{ marginTop: 16 }}>
								{t('설명')}
							</div>
							<textarea className={styles.descInput} value={subtask.desc} onChange={(e) => updateSubtaskDesc(subtask.id, e.target.value)} placeholder={t('이 서브태스크에 대해 설명해 주세요')} />

							<LinkBriefSection ownerType="subtask" ownerId={subtask.id} links={descLinks} groupName={parentTask.name} groupColor={parentTask.color} />
							<CodeBriefSection subtaskId={subtask.id} started={!!work?.started} ended={!!work?.started && !work?.alive} />
						</div>
					</>
				)}
			</div>
		</div>
	)
}

function mainTaskLinkClass() {
	return styles.mainTaskLink
}
function sessionBadgeClass(kind: 'alive' | 'done' | 'idle') {
	return `${styles.sessionBadge} ${kind === 'alive' ? styles.sessionBadgeAlive : kind === 'done' ? styles.sessionBadgeDone : styles.sessionBadgeIdle}`
}
