import { useEffect, useMemo, useRef, useState } from 'react'
import { useSessionsStore } from '../../store/useSessionsStore'
import { useTabsStore } from '../../store/useTabsStore'
import { useReviewStore } from '../../store/useReviewStore'
import { removeTask, durationEstimateReportUrl, startSubtaskWork, advanceSubtaskWork, attachTaskAsSubtask, createTask } from '../../api/sessions'
import { addBusinessDays } from '../../utils/businessDays'
import { URL_RE, extractLinks } from '../../utils/extractLinks'
import { LINK_LABEL } from '../../utils/linkDetect'
import { useT, useTp, translate, translateP, localeFor } from '../../utils/i18n'
import { useUiStore } from '../../store/useUiStore'
import BranchChain from './BranchChain'
import LinkBriefSection from './LinkBriefSection'
import TaskColorDot from './TaskColorDot'
import MainTaskPicker from './MainTaskPicker'
import RepoSelect from './RepoSelect'
import styles from './TaskDetailModal.module.css'

// "설명이 더 길어졌잖아... link는 자동으로 ui를 나누어주고 글도 나누어줘서 한눈에 볼 수 있게" —
// AI가 다듬은 설명(betterDesc)은 링크+긴 평문이 한 덩어리로 붙어 있어 읽기 어렵다. 링크는 따로
// 칩으로 빼고, 남은 글은 이미 줄바꿈이 있으면 그대로, 없으면(AI가 낸 한 덩어리 문장) 문장 단위로
// 쪼개서 각각 한 줄씩 보여준다.
// utils/linkDetect.ts의 detectLink는 createTaskFromDraft(태스크 생성)용 — 매칭 안 되는 링크도
// "콘텐츠가 있는 링크"로 취급하려고 일부러 전부 thread로 폴백한다(자동 시작 여부 판단에 씀).
// 여기 칩 라벨은 "정말 슬랙 스레드/노션/피그마/PR인지"를 정확히 표시해야 하므로 그 폴백을 쓰지
// 않고 따로 엄격하게 판정한다 — 애매하면 "노션 링크인데 스레드로 적혀있어" 같은 오분류가 생긴다.
function labelForLink(url: string, index: number): string {
	const s = url.toLowerCase()
	if (s.includes('figma.com')) return translate(LINK_LABEL.figma)
	if (s.includes('notion')) return translate(LINK_LABEL.doc)
	if (s.includes('slack.com')) return translate(LINK_LABEL.thread)
	if (s.includes('/pull/') || /#\d{3,}/.test(url)) return translate(LINK_LABEL.pr)
	return translateP('링크{n}', { n: index + 1 })
}
// "기간은 최소 0.1일부터" — 소수점 기간을 "1.0일" 대신 "1일"로, "0.3일"은 그대로 보여준다.
function fmtDays(n: number) {
	return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
function splitParagraphs(text: string): string[] {
	const withoutLinks = text
		.replace(URL_RE, '')
		.replace(/[ \t]{2,}/g, ' ')
		.trim()
	if (!withoutLinks) return []
	if (withoutLinks.includes('\n'))
		return withoutLinks
			.split(/\n+/)
			.map((s) => s.trim())
			.filter(Boolean)
	return withoutLinks
		.split(/(?<=[.!?])\s+(?=\S)/)
		.map((s) => s.trim())
		.filter(Boolean)
}

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

// TaskDetailModal(오른쪽 슬라이드 드로어)과 TaskDetailTab(메인 태스크 상세 탭) 둘 다 이 컴포넌트를
// 감싸기만 다르게 해서 그대로 재사용한다 — 실제 필드/핸들러는 여기 한 곳에만 있다. onClose는 두
// 맥락에서 의미가 다르다: 드로어에서는 "드로어 닫기", 탭에서는 "이 상세 탭 닫기"(TaskDetailTab이
// closeTab으로 연결). openWorkspace처럼 탭 전환만으로 충분한 동작은 onClose를 부르지 않는다.
// "정보구조 감사" 제안 C — 둘을 아예 하나로 합치진 않는다: 드로어(훑어보고 닫는 용도)와 탭(계속
// 열어두고 작업하는 용도)은 실제로 다른 요청("메인태스크 상세 탭이 여전히없어")에서 나온 서로 다른
// 필요다. 대신 드로어에서 탭으로 "고정"하는 다리만 놓는다 — showPinToTab은 TaskDetailTab(이미 탭
// 맥락이라 버튼이 무의미)에서만 false로 끈다.
export default function TaskDetailContent({ taskId, onClose = () => {}, showPinToTab = true }: { taskId: string | null; onClose?: () => void; showPinToTab?: boolean }) {
	const t = useT()
	const tp = useTp()
	const lang = useUiStore((s) => s.lang)
	const inbox = useSessionsStore((s) => s.inbox)
	const folders = useSessionsStore((s) => s.folders)
	const repos = useSessionsStore((s) => s.repos)
	const renameTask = useSessionsStore((s) => s.renameTask)
	const updateTaskDesc = useSessionsStore((s) => s.updateTaskDesc)
	const updateTaskDueDate = useSessionsStore((s) => s.updateTaskDueDate)
	const updateTaskDuration = useSessionsStore((s) => s.updateTaskDuration)
	const updateTaskPrompt = useSessionsStore((s) => s.updateTaskPrompt)
	const updateTaskRepo = useSessionsStore((s) => s.updateTaskRepo)
	const setFolderRepo = useSessionsStore((s) => s.setFolderRepo)
	const quickStartTask = useSessionsStore((s) => s.quickStartTask)
	const setTaskDone = useSessionsStore((s) => s.setTaskDone)
	const updateTaskColor = useSessionsStore((s) => s.updateTaskColor)
	const createSubtaskAction = useSessionsStore((s) => s.createSubtask)
	const updateSubtaskName = useSessionsStore((s) => s.updateSubtaskName)
	const updateSubtaskDesc = useSessionsStore((s) => s.updateSubtaskDesc)
	const updateSubtaskDueDate = useSessionsStore((s) => s.updateSubtaskDueDate)
	const updateSubtaskDuration = useSessionsStore((s) => s.updateSubtaskDuration)
	const setSubtaskDone = useSessionsStore((s) => s.setSubtaskDone)
	const removeSubtaskAction = useSessionsStore((s) => s.removeSubtask)

	const open = taskId !== null
	// 닫히는 애니메이션이 도는 동안에도 내용이 그대로 보여야 한다(드로어 맥락) — taskId가 곧장 null이
	// 되면 내용이 슬라이드 아웃 되기 전에 먼저 사라져 버린다. 탭 맥락에선 taskId가 안정적으로 유지되므로
	// 이 로직이 그냥 즉시 따라잡는다(해 될 것 없음).
	const [lastId, setLastId] = useState<string | null>(null)
	useEffect(() => {
		if (taskId) setLastId(taskId)
	}, [taskId])
	const quickStartBusy = useSessionsStore((s) => s.quickStartBusy === lastId)

	const found = lastId ? (inbox.find((t) => t.id === lastId) ?? folders.flatMap((f) => f.tasks).find((t) => t.id === lastId)) : null
	const folder = found?.folder_id ? folders.find((f) => f.id === found.folder_id) : null

	const [nameDraft, setNameDraft] = useState('')
	const [descDraft, setDescDraft] = useState('')
	const [descEditing, setDescEditing] = useState(false)
	const [removing, setRemoving] = useState(false)
	const nameRef = useRef<HTMLInputElement>(null)
	const descRef = useRef<HTMLTextAreaElement>(null)
	const descLinks = useMemo(() => extractLinks(descDraft), [descDraft])
	const descParagraphs = useMemo(() => splitParagraphs(descDraft), [descDraft])
	useEffect(() => {
		if (descEditing) descRef.current?.focus()
	}, [descEditing])

	// "코드작업은 무조건 서브태스크를 만들고 그 서브태스크에 워크트리를 만들어서... 순차로" — 서브태스크
	// 체이닝 진행 상태. useSessionsStore.subtaskWork 한 곳에서만 가져온다(§ refreshSubtaskWork, 사이드바와
	// 동일 소스) — 이 패널이 열려있는 동안엔 그 같은 액션을 5초마다 다시 불러 이 태스크만 더 자주
	// 갱신하되(실시간 세션 생사 확인은 tmux 조회가 들어가 있어 매초 돌릴 정도는 아님), fetch·저장
	// 경로는 여전히 하나뿐이라 사이드바 등 다른 화면도 이 패널이 열려있는 동안 덩달아 빨라진다.
	const subtaskWork = useSessionsStore((s) => (found ? s.subtaskWork[found.id] : undefined)) ?? []
	const [subtaskWorkBusy, setSubtaskWorkBusy] = useState(false)
	useEffect(() => {
		if (!open || !found) return
		useSessionsStore.getState().refreshSubtaskWork(found.id)
		const id = window.setInterval(() => useSessionsStore.getState().refreshSubtaskWork(found!.id), 5000)
		return () => window.clearInterval(id)
	}, [open, found?.id])
	async function startDev() {
		if (!found || subtaskWorkBusy) return
		setSubtaskWorkBusy(true)
		await startSubtaskWork(found.id)
		await useSessionsStore.getState().loadBoard() // ensureWorkUnitSubtasks가 서버에서 새 서브태스크를 만들었을 수 있음
		await useSessionsStore.getState().refreshSubtaskWork(found.id)
		setSubtaskWorkBusy(false)
	}
	async function advanceDev() {
		if (!found || subtaskWorkBusy) return
		setSubtaskWorkBusy(true)
		await advanceSubtaskWork(found.id)
		await useSessionsStore.getState().refreshSubtaskWork(found.id)
		setSubtaskWorkBusy(false)
	}

	// "일감 검토" — 예전엔 잡 상태(jobId/폴링)를 이 컴포넌트 로컬 state로 들고 있어서 드로어를 닫으면
	// (=언마운트) 진행 상황을 놓쳤다. "다른 걸 하고 있어도 백그라운드에서 돌아서 다 되면 확인할 수
	// 있게" 요청으로 useReviewStore(태스크id 기준 전역, 마운트와 무관하게 계속 폴링)로 옮겼다 —
	// 이 컴포넌트는 그 상태를 구독만 한다. 사이드바(SessionShell)도 같은 스토어를 구독해 진행 목록을 보여준다.
	const review = useReviewStore((s) => (found ? s.jobs[found.id] : undefined))
	const startReview = useReviewStore((s) => s.startReview)
	const setReviewApplied = useReviewStore((s) => s.setApplied)
	const reviewBusy = !!review && !review.error && !review.status?.done
	// "태스크 등록은 적용 후에 나오도록" + "적용이 되면... 수정 버튼을 눌러야 수정되도록" — 두 요청
	// 모두 같은 신호(적용됐는지)를 쓴다. 태스크별로 useReviewStore에 둔다(로컬 state였다면 다른
	// 태스크를 봤다 돌아왔을 때 review?.jobId는 그대로인데도 잠금 여부가 꼬일 수 있었다).
	const applied = !!review?.applied
	// "메인 태스크의 기간은 전체 일정의 기간산정으로... 모든 일정을 더하기해서 자동으로 적용" — 서브태스크에
	// 예정일이 하나라도 있으면 태스크 자신의 마감일/기간은 서버(recomputeFromSubtasks)가 그 전체 범위로
	// 자동 계산해 덮어쓰므로, 여기서 직접 편집하게 두면 바로 다음 서브태스크 변경 때 조용히 무시된다.
	const hasScheduledSubtasks = !!found?.subtasks.some((st) => !!st.due_date)

	// 열릴 때마다(다른 태스크로 바뀔 때도) 그 태스크의 현재 값으로 다시 채운다. AI 검토 상태는 여기서
	// 리셋하지 않는다 — useReviewStore가 태스크별로 독립적으로 들고 있으므로 다른 태스크를 봤다 와도 유지.
	useEffect(() => {
		if (found) {
			setNameDraft(found.name)
			setDescDraft(found.desc)
			setDescEditing(false)
			setRemoving(false)
		}
	}, [found?.id]) // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (!open) return
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [open, onClose])

	function commitName() {
		if (found && nameDraft.trim() && nameDraft !== found.name) renameTask(found.id, nameDraft.trim())
	}
	function commitDesc() {
		if (found && descDraft !== found.desc) updateTaskDesc(found.id, descDraft)
		setDescEditing(false)
	}
	function runAiReview() {
		if (!found || reviewBusy) return
		startReview(found.id, found.name)
	}
	// "적용 하나만 있으면 될 것 같아" — 기간/설명/계획을 따로따로 적용하지 않고 버튼 하나로 한 번에.
	function applyAll() {
		if (!found || !review?.status?.result?.ok) return
		const r = review.status.result
		// "기간은 최소 0.1일부터" — 검토 결과는 0.1일 단위 소수지만 캘린더 기간(duration_days)은 영업일
		// 정수 칸이라 그대로 못 넣는다. 0.3일처럼 하루보다 작아도 실제 일정은 최소 1영업일 칸을 차지하니
		// 올림(ceil)한다 — 내림하면 0일짜리 일정이 생겨버린다.
		updateTaskDuration(found.id, Math.max(1, Math.ceil(r.days)))
		if (r.betterDesc) {
			setDescDraft(r.betterDesc)
			updateTaskDesc(found.id, r.betterDesc)
		}
		if (r.plan.length) updateTaskPrompt(found.id, r.plan.join('\n'))
		setDescEditing(false)
		setReviewApplied(found.id, true)
	}
	// "적용이 되면 일반 UI로 수정이 안되는 UI로 변경되고 수정 버튼을 눌러야 수정되도록" — 기간/설명을
	// 잠그고, 이 버튼으로만 다시 풀 수 있다(풀리면 "태스크 등록"도 같이 사라진다 — 아직 재검토/재확정
	// 안 된 상태이므로).
	function unlockReview() {
		if (!found) return
		setReviewApplied(found.id, false)
	}
	// "메인태스크 상세 탭이 여전히없어" — 이 버튼이 실제로 뜨는 건 folder(승격된 태스크)가 있을 때뿐이라,
	// 상세 탭(폴더 노드) 맥락에서 항상 folder.id === 지금 보고 있는 그 노드 자신이다. found.id(태스크
	// id)가 아니라 folder.id로 그 노드의 "터미널" 탭을 열고 포커스한다(같은 노드라 setActiveNode는
	// no-op — openOrFocusTab만으로 충분).
	function openWorkspace() {
		if (!found || !folder) return
		useTabsStore.getState().openOrFocusTab(folder.id, 'terminal')
		onClose()
	}
	// isPrimaryTask — 이 태스크가 folder.tasks[0](TaskDetailTab이 "메인 태스크"로 삼는 그 태스크)일
	// 때만 대응하는 탭 목적지가 있다. 다른 태스크(일감함 미승격, 다중 태스크 폴더의 2번째 이후)는
	// 아직 그 자리가 없다.
	const isPrimaryTask = !!folder && folder.tasks[0]?.id === found?.id
	function pinToTab() {
		if (!found || !folder) return
		useTabsStore.getState().setActiveNode(folder.id, 'detail')
		useTabsStore.getState().openOrFocusTab(folder.id, 'detail')
		onClose()
	}
	async function register() {
		if (!found) return
		await quickStartTask(found.id)
		onClose()
	}
	// "태스크 등록은 적용 후에 나오도록" — applied가 true일 때만 보이는 버튼이라 기간/설명/계획은 이미
	// applyAll에서 반영된 상태다. 여기선 마감일만 기본값(오늘, NewTaskModal과 동일 관례) 채우고 시작.
	async function registerFromReview() {
		if (!found || !review?.status?.result?.ok) return
		if (found.due_date == null) await updateTaskDueDate(found.id, Date.now())
		await quickStartTask(found.id)
		onClose()
	}
	async function remove() {
		if (!found || !confirm(tp('"{name}"을(를) 삭제할까요?', { name: found.name }))) return
		setRemoving(true)
		await removeTask(found.id)
		await useSessionsStore.getState().loadBoard()
		onClose()
	}

	if (!found) return null
	return (
		<>
			<div className={styles.head}>
				{/* "월캘린더에서 임의로 색상 바꾸는 거 추가하고싶어... 태스크하나를 색하나로" — 캘린더
				    배경에 쓰이는 태스크 커스텀 색을 여기서 바로 고른다. */}
				<TaskColorDot color={found.color} onPick={(color) => updateTaskColor(found.id, color)} />
				<input
					ref={nameRef}
					className={styles.nameInput}
					style={found.completed_at ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}
					value={nameDraft}
					onChange={(e) => setNameDraft(e.target.value)}
					onBlur={commitName}
					onKeyDown={(e) => {
						if (e.key === 'Enter') nameRef.current?.blur()
					}}
				/>
				{/* "정보구조 감사" 제안 C — 훑어보던 드로어를 계속 열어두고 싶을 때 탭으로 넘긴다. 대응하는
				    탭 목적지가 있을 때만(isPrimaryTask) 보이고, 이미 탭 맥락(TaskDetailTab)이면 안 보인다. */}
				{showPinToTab && isPrimaryTask && (
					<button type="button" className={styles.pinTabBtn} onClick={pinToTab} title={t('이 상세를 탭으로 열어 계속 봅니다')}>
						{t('탭으로 보기')}
					</button>
				)}
				{/* "일감 완료 체크가 있으면 좋겠어. 그걸하면 그냥 완료로 보이는거야" — 체크하면 레코드는
				    안 지우고 completed_at만 찍혀 태스크 트리에서 사라진다(캘린더엔 그대로 남음). 여기가
				    유일하게 다시 되돌릴 수 있는 자리다. "완료 위치 개선... 체크박스 기능을 하는 버튼으로"
				    — 네이티브 체크박스+텍스트 대신 눌리는 버튼처럼 보이는 토글로, 닫기(×) 버튼과
				    붙어 보이지 않게 여백을 둔다. */}
				<button
					type="button"
					className={`${styles.doneToggle} ${found.completed_at ? styles.doneToggleActive : ''}`}
					onClick={() => setTaskDone(found.id, !found.completed_at)}
					title={t('완료 처리 — 태스크 트리에서는 사라지고 캘린더에는 남습니다')}
				>
					<span className={styles.doneCheck} />
					{t('완료')}
				</button>
				<button type="button" className={styles.closeBtn} onClick={onClose} title={t('닫기')}>
					×
				</button>
			</div>

			<div className={styles.body}>
				{/* "일감 검토로... 제목 근처 라인으로 버튼 옮기고" — 태스크를 열자마자 가장 먼저 보이는
				    자리로 옮겼다. 이제 기간 추정뿐 아니라 개발 계획·설명 보강까지 한 번에 나온다. */}
				<div className={styles.reviewBlock}>
					<button type="button" className={styles.reviewBtn} disabled={reviewBusy || !descDraft.trim()} onClick={runAiReview} title={!descDraft.trim() ? t('설명을 먼저 적어주세요') : t('Claude Code로 구현+테스트까지 걸릴 영업일, 개발 계획, 보강된 설명을 검토합니다 — 코드를 직접 확인하느라 몇 분 걸릴 수 있어요. 드로어를 닫아도 백그라운드에서 계속 돌고, 사이드바에서 진행 상황을 볼 수 있어요.')}>
						{reviewBusy ? t('검토 중…') : t('일감 검토')}
					</button>
					{review?.error && (
						<div className={styles.aiSuggestBox}>
							<span className={styles.aiSuggestError}>{t(review.error)}</span>
						</div>
					)}
					{reviewBusy && review?.status && (
						<div className={styles.aiSuggestBox}>
							<div className={styles.aiProgressLabel}>
								<span>{t(review.status.label ?? '준비 중…')}</span>
								<span>{review.status.percent ?? 5}%</span>
							</div>
							<div className={styles.aiProgressTrack}>
								<div
									className={styles.aiProgressFill}
									style={{
										transform: `scaleX(${(review.status.percent ?? 5) / 100})`,
									}}
								/>
							</div>
							<div className={styles.aiProgressTokens}>
								{tp('토큰 {tokens} · {sec}초', {
									tokens: (review.status.tokens.input + review.status.tokens.output + review.status.tokens.cacheRead + review.status.tokens.cacheCreation).toLocaleString(localeFor(lang)),
									sec: Math.round(review.status.elapsedMs / 1000),
								})}
							</div>
						</div>
					)}
					{review?.status?.done && review.status.result && (
						<div className={styles.aiSuggestBox}>
							{review.status.result.ok ? (
								<>
									{/* "태스크 누르면 화면이 하얘져" — devDays/testDays/whyLong은 이번에 새로 추가된 필드라,
									    스키마 바뀌기 전에 이미 완료돼 DB에 영구 저장된 옛 검토 결과에는 없다(하이드레이션은
									    저장된 그대로 돌려줄 뿐 마이그레이션하지 않는다). hasSplit로 있을 때만 새 UI를 쓰고,
									    없으면 원래 하나였던 days로 조용히 폴백 — undefined.toFixed() 크래시 방지. */}
									{(() => {
										const r = review.status.result
										const hasSplit = 'devDays' in r && 'testDays' in r
										return (
											<>
												<div className={styles.aiSuggestHead}>
													<span className={styles.aiSuggestTotal}>
														{tp('일감 검토 — 총 {days}일', { days: fmtDays(r.days) })}
														{applied ? t(' · 적용됨') : ''}
													</span>
													<a className={styles.aiReportLink} href={durationEstimateReportUrl(found.id, review.jobId)} target="_blank" rel="noreferrer">
														{t('자세히 보기')}
													</a>
													{/* "적용 하나만 있으면 될 것 같아" — 기간/설명/계획 따로가 아니라 버튼 하나로 한 번에.
													    "적용이 되면 수정 안 되는 UI로... 수정 버튼을 눌러야" — 적용 후엔 같은 자리가 수정(잠금 해제)으로 바뀐다. */}
													{applied ? (
														<button type="button" className={styles.aiSuggestApply} onClick={unlockReview}>
															{t('수정')}
														</button>
													) : (
														<button type="button" className={styles.aiSuggestApply} onClick={applyAll} title={t('기간·설명·개발 계획을 한 번에 반영합니다')}>
															{t('적용')}
														</button>
													)}
												</div>
												{/* "너가 작업한다고 가정했을때를 개발기한으로, 개발자 테스트 기한은 그걸 내가 확인하는
												    작업으로 잡아야해" — Claude 구현 시간과 사람 검증 시간을 나눠서 보여준다. */}
												{hasSplit && (
													<div className={styles.aiSuggestSplit}>
														{tp('개발(Claude) {devDays}일 · 테스트(직접 확인) {testDays}일', { devDays: fmtDays(r.devDays), testDays: fmtDays(r.testDays) })}
													</div>
												)}
												{/* "만약 길게잡힌게 맞다면. 강조를 해줬으면해. 어떤 것들로 인해 길게 잡을 수 밖에 없었다"
												    — 총합이 1일을 넘길 때만 judge가 채우는 핵심 이유 한 줄을 눈에 띄게 강조한다. */}
												{r.whyLong && <div className={styles.aiWhyLong}>{tp('⏱ 왜 이만큼 걸리나요 — {reason}', { reason: r.whyLong })}</div>}
												<ul className={styles.aiBreakdownList}>
													{r.breakdown.map((b, i) => (
														<li key={i} className={styles.aiBreakdownRow}>
															<span className={styles.aiBreakdownItem}>{b.item}</span>
															<span className={styles.aiBreakdownDays}>{tp('{n}일', { n: hasSplit ? `${fmtDays(b.devDays)}+${fmtDays(b.testDays)}` : fmtDays(b.days) })}</span>
															<span className={styles.aiBreakdownNote}>{b.note}</span>
														</li>
													))}
												</ul>
											</>
										)
									})()}
									{review.status.result.betterDesc && (
										<div className={styles.aiPlanRow}>
											<span className={styles.aiPlanHint}>{tp('설명도 다듬었어요: "{text}…"', { text: review.status.result.betterDesc.slice(0, 50) })}</span>
										</div>
									)}
									{review.status.result.plan.length > 0 && (
										<div className={styles.aiPlanRow}>
											<span className={styles.aiPlanHint}>{tp('개발 계획 {n}단계도 함께 나왔어요(자세히 보기에서 확인)', { n: review.status.result.plan.length })}</span>
										</div>
									)}
									{/* "태스크 등록은 적용 후에 나오도록" — 적용을 안 눌렀으면 아직 검토 결과가 실제
									    필드에 반영 안 된 상태라 등록 버튼 자체를 숨긴다. */}
									{applied && !folder && (
										<div className={styles.aiRegisterRow}>
											<span className={styles.aiPlanHint}>{t('등록하면 캘린더에도 일정이 잡혀요')}</span>
											<button type="button" className={styles.aiRegisterBtn} disabled={quickStartBusy} onClick={registerFromReview}>
												{quickStartBusy ? t('등록 중…') : t('태스크 등록')}
											</button>
										</div>
									)}
									<div className={styles.aiProgressTokens}>
										{tp('토큰 {tokens}', { tokens: (review.status.tokens.input + review.status.tokens.output + review.status.tokens.cacheRead + review.status.tokens.cacheCreation).toLocaleString(localeFor(lang)) })}
										{review.status.costUsd != null ? tp(' · 약 ${cost}', { cost: review.status.costUsd.toFixed(3) }) : ''}
									</div>
								</>
							) : review.status.result.tooVague ? (
								<div className={styles.aiSuggestWarn}>
									<span>{tp('설명이 너무 막연해서 검토를 중단했습니다 — {reason}', { reason: review.status.result.error })}</span>
									<a className={styles.aiReportLink} href={durationEstimateReportUrl(found.id, review.jobId)} target="_blank" rel="noreferrer">
										{t('조사 내용 보기')}
									</a>
									<button type="button" className={styles.aiSuggestWarnFocus} onClick={() => setDescEditing(true)}>
										{t('설명 작성하러 가기')}
									</button>
								</div>
							) : (
								<span className={styles.aiSuggestError}>{t(review.status.result.error)}</span>
							)}
						</div>
					)}
				</div>

				<div className={styles.metaRow}>
					<span className={styles.metaLabel}>{t('마감일')}</span>
					{hasScheduledSubtasks ? (
						<span className={styles.metaLockedValue}>{found.due_date ? msToDateInputValue(found.due_date) : '—'}</span>
					) : (
						<input type="date" className="fin m" style={{ width: 150, height: 30 }} value={found.due_date ? msToDateInputValue(found.due_date) : ''} onChange={(e) => updateTaskDueDate(found.id, e.target.value ? dateInputValueToMs(e.target.value) : null)} />
					)}
					{!hasScheduledSubtasks && found.due_date !== null && (
						<button type="button" className={styles.metaClear} onClick={() => updateTaskDueDate(found.id, null)}>
							{t('지우기')}
						</button>
					)}
					{hasScheduledSubtasks && <span className={styles.metaHint}>{t('서브태스크 일정으로 자동 계산됨')}</span>}
				</div>

				{found.due_date !== null && (
					<div className={styles.metaRow}>
						<span className={styles.metaLabel}>{t('기간')}</span>
						{/* "적용이 되면 일반 UI로 수정이 안되는 UI로 변경" — 검토 적용 직후·서브태스크로 자동
						    산정되는 동안엔 실수로 값을 바꾸지 못하게 입력창 대신 읽기 전용 표시로. */}
						{applied || hasScheduledSubtasks ? (
							<span className={styles.metaLockedValue}>{found.duration_days ?? 1}</span>
						) : (
							<input
								type="number"
								min={1}
								className="fin m"
								style={{ width: 56, height: 30 }}
								placeholder="1"
								value={found.duration_days ?? ''}
								onChange={(e) => {
									const v = e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null
									updateTaskDuration(found.id, v)
								}}
							/>
						)}
						<span className={styles.metaHint}>{t('영업일')}</span>
						{found.duration_days !== null && found.duration_days > 1 && (
							<span className={styles.metaHint}>
								{tp('~ {month}월 {day}일 종료', {
									month: new Date(addBusinessDays(found.due_date, found.duration_days)).getMonth() + 1,
									day: new Date(addBusinessDays(found.due_date, found.duration_days)).getDate(),
								})}
							</span>
						)}
						{!applied && !hasScheduledSubtasks && found.duration_days !== null && (
							<button type="button" className={styles.metaClear} onClick={() => updateTaskDuration(found.id, null)}>
								{t('지우기')}
							</button>
						)}
					</div>
				)}

				{/* "태스크 하나에 개발, 개발자테스트, QA, 배포 이런식으로 나뉠 수 있거든... 서브태스크
				    설명란이 따로 존재해야해" — 이름·설명·예정일·기간을 태스크와 독립적으로 갖는다.
				    캘린더에서 드래그로 옮긴 값도 여기 바로 반영된다(같은 store 상태를 보고 있어서). */}
				<div className={styles.subtasksSection}>
					<div className={styles.subtasksHead}>
						<span className={styles.metaLabel}>{t('서브태스크')}</span>
						<button type="button" className={styles.subtaskAddBtn} onClick={() => createSubtaskAction(found.id, { name: t('서브태스크') })}>
							{t('+ 추가')}
						</button>
						{/* "서브태스크를 골라서 넣을 수 있게 해줘" — attachTaskAsSubtask의 반대 방향 진입점.
						    일감함에 독립적으로 떠 있는 태스크를 골라 이 태스크의 서브태스크로 편입한다. */}
						<MainTaskPicker
							label={t('기존 태스크에서 선택')}
							candidates={inbox.filter((t) => t.id !== found.id).map((t) => ({ id: t.id, name: t.name }))}
							onPick={async (candidateId) => {
								const r = await attachTaskAsSubtask(candidateId, found.id)
								if (r.ok) await useSessionsStore.getState().loadBoard()
							}}
						/>
						{/* "코드작업은 무조건 서브태스크를 만들고 그 서브태스크에 워크트리를 만들어서... 순차로"
						    — 서브태스크가 없으면 AI 검토의 workUnits로 자동 생성하며 첫 단계를 시작하고,
						    이미 진행 중이면 다음 서브태스크로 넘긴다. */}
						{subtaskWork.some((w) => w.started) ? (
							<button
								type="button"
								className={styles.subtaskAddBtn}
								disabled={subtaskWorkBusy || !subtaskWork.some((w) => w.alive)}
								onClick={advanceDev}
								title={t('지금 진행 중인 서브태스크를 끝내고 다음 서브태스크의 워크트리를 새로 만듭니다')}
							>
								{t('다음 단계로 →')}
							</button>
						) : (
							<button
								type="button"
								className={styles.subtaskAddBtn}
								disabled={subtaskWorkBusy}
								onClick={startDev}
								title={t('서브태스크가 없으면 AI 검토의 업무 단위로 자동 생성 후, 첫 서브태스크의 워크트리+클로드 세션을 시작합니다')}
							>
								{t('개발 시작')}
							</button>
						)}
					</div>
					{found.subtasks.length === 0 && <div className={styles.subtasksEmpty}>{t('아직 없음 — "개발 시작"을 누르면 AI 검토 결과로 자동 생성되거나, "+ 추가"로 직접 QA/배포 등을 만들 수 있어요.')}</div>}
					{found.subtasks.map((st) => {
						const work = subtaskWork.find((w) => w.id === st.id)
						return (
						<div key={st.id} className={styles.subtaskRow}>
							<div className={styles.subtaskRowHead}>
								{work?.started && (
									<span
										className={`${styles.subtaskWorkBadge} ${work.alive ? styles.subtaskWorkBadgeAlive : styles.subtaskWorkBadgeDone}`}
										title={work.branch ? tp('브랜치: {branch}', { branch: work.branch }) : undefined}
									>
										{work.alive ? t('진행 중') : t('세션 종료')}
									</span>
								)}
								<input
									className={styles.subtaskNameInput}
									style={st.completed_at ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}
									defaultValue={st.name}
									onBlur={(e) => {
										const v = e.target.value.trim()
										if (v && v !== st.name) updateSubtaskName(st.id, v)
									}}
								/>
								<input
									type="date"
									className="fin m"
									style={{ width: 118, height: 26 }}
									value={st.due_date ? msToDateInputValue(st.due_date) : ''}
									onChange={(e) => updateSubtaskDueDate(st.id, e.target.value ? dateInputValueToMs(e.target.value) : null)}
								/>
								<input
									type="number"
									min={1}
									className="fin m"
									style={{ width: 44, height: 26 }}
									placeholder={t('일')}
									title={t('영업일')}
									value={st.duration_days ?? ''}
									onChange={(e) => updateSubtaskDuration(st.id, e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null)}
								/>
								{/* "서브태스크 완료 버튼 필요" — 예정일이 없는 서브태스크는 완료해도 캘린더에 안 뜨고
								    사이드바 subChain 목록에서도 사라지므로(§ TaskRow.visibleSubtasks), 이 목록이
								    유일하게 항상 남는 되돌리기 자리다. */}
								<button
									type="button"
									className={`${styles.subtaskDoneBtn} ${st.completed_at ? styles.subtaskDoneBtnActive : ''}`}
									onClick={() => setSubtaskDone(st.id, !st.completed_at)}
									title={t('완료 처리 — 사이드바 목록에서는 사라지고 캘린더에는 남습니다')}
								>
									✓
								</button>
								<button type="button" className={styles.subtaskRemoveBtn} onClick={() => removeSubtaskAction(st.id)} title={t('삭제')}>
									×
								</button>
							</div>
							<textarea
								className={styles.subtaskDescInput}
								defaultValue={st.desc}
								placeholder={t('이 단계만의 설명(선택)')}
								onBlur={(e) => {
									if (e.target.value !== st.desc) updateSubtaskDesc(st.id, e.target.value)
								}}
							/>
						</div>
						)
					})}
				</div>

				{repos.length > 0 && (
					<div className={styles.metaRow}>
						<span className={styles.metaLabel}>{t('레포')}</span>
						<RepoSelect
							repos={repos}
							valueId={(folder ? folder.repo_id : found.repo_id) ?? null}
							onChange={(repoId) => {
								// 폴더로 승격된 태스크는 레포가 폴더 단위 배정(§ folders.repo_id 마이그레이션) —
								// 여기서 바꾸면 그 폴더의 다른 서브태스크에도 같이 적용된다. 미분류(inbox) 태스크는 자기 것만.
								if (folder) setFolderRepo(folder.id, repoId)
								else updateTaskRepo(found.id, repoId)
							}}
						/>
						{!folder && found.repo_id && <span className={styles.metaHint}>{t('(AI 자동배정)')}</span>}
						{/* "드롭다운은 바뀌어 보이는데 실제 작업(워크트리/세션)은 옛 레포 그대로" — 이미 워크트리를
						    만든 서브태스크는 그 레포에 이미 체크아웃돼 있어 레포를 바꿔도 저절로 옮겨가지 않는다
						    (git worktree 특성상 불가능 — 새로 시작해야 옮겨감). 안 바뀐 게 버그처럼 보이지
						    않게 그 자리에서 바로 알려준다. */}
						{folder && subtaskWork.some((w) => w.started) && <span className={styles.metaHint}>{t('이미 시작된 서브태스크는 그때 배정된 레포 그대로 진행돼요 — 다음 서브태스크부터 적용됩니다')}</span>}
					</div>
				)}

				{/* "서브태스크 추가 기능있는건 무슨 태스크야?" — 이미 자기 서브태스크가 있는 태스크를
				    "메인 태스크로 편입"하면 attachTaskAsSubtask가 원래 태스크 레코드를 지우면서
				    그 밑의 서브태스크까지 CASCADE로 같이 사라진다(2단 중첩 서브태스크 개념이 없어서).
				    자기 서브태스크가 있으면 이 옵션 자체를 숨겨 그 사고를 원천 차단한다. */}
				{!found.folder_id && found.subtasks.length === 0 && (
					<div className={styles.metaRow}>
						<span className={styles.metaLabel}>{t('메인 태스크')}</span>
						<MainTaskPicker
							candidates={folders
								.flatMap((f) => f.tasks)
								.filter((t) => t.id !== found.id)
								.map((t) => ({ id: t.id, name: t.name }))}
							onPick={async (mainTaskId) => {
								const mainName = folders.flatMap((f) => f.tasks).find((t) => t.id === mainTaskId)?.name || ''
								if (!confirm(tp('"{name}"을(를) "{mainName}"의 서브태스크로 편입할까요? 원래 태스크 기록은 삭제됩니다.', { name: found.name, mainName }))) return
								const r = await attachTaskAsSubtask(found.id, mainTaskId)
								if (r.ok) {
									await useSessionsStore.getState().loadBoard()
									onClose()
								}
							}}
							onCreateNew={async (name) => {
								const task = await createTask({ folderId: null, name })
								// quickStartTask는 스토어 로컬 상태(inbox/folders)에서 이 태스크를 찾아야 승격이
								// 진행된다 — 방금 API로 직접 만들어서 아직 로컬 상태엔 없으니 먼저 새로고침한다.
								await useSessionsStore.getState().loadBoard()
								await quickStartTask(task.id)
								return task.id
							}}
						/>
					</div>
				)}

				<div className={styles.descLabel}>
					{t('설명')}
					{/* "적용이 되면... 수정 버튼을 눌러야 수정되도록" — 잠긴 동안은 위 검토 박스의 "수정"
					    버튼으로만 풀린다(§ applied). */}
					{applied && <span className={styles.descLockedHint}>{t('검토 적용됨 — 위 "수정"으로 편집')}</span>}
				</div>
				{descEditing && !applied ? (
					<textarea ref={descRef} className={styles.descInput} value={descDraft} onChange={(e) => setDescDraft(e.target.value)} onBlur={commitDesc} placeholder={t('이 일감에 대해 설명해 주세요')} />
				) : (
					// "설명이 더 길어졌잖아... link는 자동으로 ui를 나누어주고 글도 나누어줘서 한눈에
					// 볼 수 있게" — AI가 다듬은 긴 설명을 그대로 textarea에 욱여넣지 않고, 링크는
					// 칩으로 따로 빼고 나머지 글은 문장 단위로 줄을 나눠 보여준다. 클릭하면 편집 모드로.
					<div className={`${styles.descView} ${applied ? styles.descViewLocked : ''}`} onClick={applied ? undefined : () => setDescEditing(true)}>
						{descDraft.trim() ? (
							<>
								{descLinks.length > 0 && (
									<div className={styles.descLinkRow}>
										{descLinks.map((url, i) => {
											return (
												<a key={url} href={url} target="_blank" rel="noreferrer" className={styles.descLinkChip} onClick={(e) => e.stopPropagation()} title={url}>
													{labelForLink(url, i)} ↗
												</a>
											)
										})}
									</div>
								)}
								{descParagraphs.map((p, i) => (
									<p key={i} className={styles.descPara}>
										{p}
									</p>
								))}
							</>
						) : (
							<span className={styles.descPlaceholder}>{t('이 일감에 대해 설명해 주세요')}</span>
						)}
					</div>
				)}

				<LinkBriefSection ownerType="task" ownerId={found.id} links={descLinks} groupName={found.name} groupColor={found.color} />

				{found.branches.length > 0 && (
					<div className={styles.branchSection}>
						<div className={styles.descLabel}>{t('브랜치')}</div>
						<BranchChain branches={found.branches} kind={found.kind} groupBase={folder?.base ?? null} />
					</div>
				)}
			</div>

			<div className={styles.actions}>
				<button type="button" className={styles.deleteBtn} disabled={removing} onClick={remove}>
					{t('삭제')}
				</button>
				<div className={styles.actionsSpacer} />
				{folder ? (
					<button type="button" className={styles.primaryBtn} onClick={openWorkspace}>
						{t('작업 열기')}
					</button>
				) : (
					<button type="button" className={styles.primaryBtn} disabled={quickStartBusy} onClick={register}>
						{quickStartBusy ? t('등록 중…') : t('태스크로 등록')}
					</button>
				)}
			</div>
		</>
	)
}
