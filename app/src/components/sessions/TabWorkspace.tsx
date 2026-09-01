import { useEffect, useRef, useState } from 'react'
import { useSessionsStore, getOrchestration } from '../../store/useSessionsStore'
import { useTabsStore, TAB_LABEL, CRONJOBS_NODE_ID, MODEL_POLICY_NODE_ID, CALENDAR_NODE_ID, CONTROL_NODE_ID, TEAM_RULES_NODE_ID, wtPathFromNodeId } from '../../store/useTabsStore'
import type { TabKind, TabInstance } from '../../store/useTabsStore'
import type { Task } from '../../store/types'
import { createTerm } from '../../api/term'
import { getSubtaskWorkState } from '../../api/sessions'
import { useT } from '../../utils/i18n'
import XTerm from '../terminal/XTerm'
import ServerPane from './ServerPane'
import BrowserPane from './BrowserPane'
import SubagentStrip from './SubagentStrip'
import OrchestratorPane from './OrchestratorPane'
import TaskManagerBoard from './TaskManagerBoard'
import TaskDetailTab from './TaskDetailTab'
import CronJobsPane from './CronJobsPane'
import ModelPolicyPane from './ModelPolicyPane'
import TeamRulesPane from './TeamRulesPane'
import { TAB_ICON } from './tabIcons'
import CalendarPane from './CalendarPane'
import ControlPane from './ControlPane'
import styles from './TabWorkspace.module.css'

// 오케스트레이터·태스크(서브태스크) 노드 둘 다 같은 탭 개념을 쓴다 — "+"로 열 수 있는 종류는 노드
// 종류에 따라서만 달라진다(폴더엔 "오케스트레이터"가 하나 더 있음, 그 자리에 "새 워크트리"는 없음).
// 터미널/로컬 서버/브라우저/클로드 세션의 백엔드는 노드에 따라 다른 세션을 가리킨다 — 태스크 노드는
// 그 서브태스크의 오케스트레이션 세션, 폴더 노드는 그 폴더의 지휘자(conductor) 세션.
// "태스크내에서 비서로 화면 바뀌는게 불편해서 그냥 탭에서 사용할 수 있게" — 'control'을 두 목록 다에
// 추가. ControlPane은 노드 스코프가 없는 전역 비서라 어느 태스크/서브태스크 탭에서 열어도 항상 같은
// 세션(CONTROL_NODE_ID에서 보던 것과 동일)을 이어서 보여준다.
const ADDABLE_TASK_TABS: TabKind[] = ['terminal', 'server', 'browser', 'claude', 'control']
// "팀 규칙 탭이 어딧어? 추가도 안되고" — 설정 모달에만 진입점을 두니(모델 배정과 같은 패턴) 못 찾는다.
// 팀 규칙은 레포 단위지만 사람은 "이 폴더 작업하다가 그 레포 규칙을 보고 싶다"는 맥락에서 찾으니,
// 여기 폴더 전용 "+" 메뉴에도 넣는다 — 열면 그 폴더의 레포로 미리 스코프된다(§ TeamRulesPane initialRepoId).
// "로컬서버는 제거해줘" — 메인 태스크(폴더)는 이제 자기 워크트리를 안 갖고 오케스트레이션만 하므로(§
// orchestrator.cjs start 주석) 여기서 "로컬 서버"는 가리킬 대상이 없다. 서브태스크 탭(ADDABLE_TASK_TABS)
// 에만 남긴다 — 실제 워크트리·dev 서버는 거기서 돈다.
const ADDABLE_FOLDER_TABS: TabKind[] = ['detail', 'orchestrator', 'diagram', 'terminal', 'browser', 'claude', 'teamRules', 'control']

// VSCode의 "새 터미널"처럼 탭을 열면 버튼 없이 곧바로 세션이 뜬다 — 탭 인스턴스당 한 번만
// 시작하도록 startedRef로 막는다(StrictMode 이중 마운트·재렌더 대비).
function ClaudeSessionPane({ tabId, cwd }: { tabId: string; cwd: string }) {
	const t = useT()
	const sessionName = useTabsStore((s) => s.claudeSessionByTab[tabId])
	const modelLabel = useTabsStore((s) => s.claudeModelByTab[tabId])
	const setClaudeSession = useTabsStore((s) => s.setClaudeSession)
	const [error, setError] = useState<string | null>(null)
	const startedRef = useRef(false)

	useEffect(() => {
		if (sessionName || startedRef.current) return
		startedRef.current = true
		createTerm({ cwd, command: 'claude', label: `${tabId.slice(0, 8)}-claude` })
			.then((r) => {
				if (r.ok) setClaudeSession(tabId, r.name, r.modelLabel)
				else setError(t(r.error || '세션 생성 실패'))
			})
			.catch((e) => setError(e instanceof Error ? e.message : String(e)))
	}, [tabId, cwd, sessionName, setClaudeSession])

	if (sessionName) return <XTerm session={sessionName} cwd={cwd} modelLabel={modelLabel} />
	if (error)
		return (
			<div className={styles.stub}>
				<div className={styles.stubTitle}>{t('세션을 시작하지 못했습니다')}</div>
				<div className={styles.stubError}>{error}</div>
			</div>
		)
	return (
		<div className={styles.stub}>
			<div className={styles.stubTitle}>{t('클로드 세션 시작 중…')}</div>
		</div>
	)
}

// 워크트리 목록에서 "미추적" 워크트리를 클릭했을 때 여는 즉석 셸(claude 명령 없이 plain tmux 세션).
// OpenTask 태스크가 아니라 claudeSessionByTab/claudeModelByTab 저장소를 그대로 재사용 — 이름은
// "클로드"지만 실제로는 tabId → tmux 세션명 매핑일 뿐이라 일반 터미널에도 그대로 쓸 수 있다.
function AdHocTerminalPane({ tabId, cwd }: { tabId: string; cwd: string }) {
	const t = useT()
	const sessionName = useTabsStore((s) => s.claudeSessionByTab[tabId])
	const setClaudeSession = useTabsStore((s) => s.setClaudeSession)
	const [error, setError] = useState<string | null>(null)
	const startedRef = useRef(false)

	useEffect(() => {
		if (sessionName || startedRef.current) return
		startedRef.current = true
		createTerm({ cwd, label: cwd.split('/').pop() })
			.then((r) => {
				if (r.ok) setClaudeSession(tabId, r.name, null)
				else setError(t(r.error || '세션 생성 실패'))
			})
			.catch((e) => setError(e instanceof Error ? e.message : String(e)))
	}, [tabId, cwd, sessionName, setClaudeSession])

	if (sessionName) return <XTerm session={sessionName} cwd={cwd} modelLabel={null} />
	if (error)
		return (
			<div className={styles.stub}>
				<div className={styles.stubTitle}>{t('세션을 시작하지 못했습니다')}</div>
				<div className={styles.stubError}>{error}</div>
			</div>
		)
	return (
		<div className={styles.stub}>
			<div className={styles.stubTitle}>{t('터미널 시작 중…')}</div>
		</div>
	)
}

// "모든 서브태스크는 클릭해서 탭을 추가할 수 있고... 워크트리가 있다면 워크트리내에서 클로드 세션을
// 띄우고 없다면 서브태스크인걸 인지하는 클로드세션만 띄워줘" — 이 서브태스크가 이미 launchSubtask로
// 시작돼 살아있는 세션이 있으면 그 워크트리에 그대로 붙고, 아직 없으면(사람이 "개발 시작"을 누르기
// 전) 워크트리 없이 즉석 세션을 하나 띄우되 이 서브태스크 맥락(이름·설명)을 시드로 알려준다 — 여기서
// 워크트리를 새로 만들지는 않는다(그건 "개발 시작" 버튼의 몫 — 메인태스크는 오케스트레이션만).
function SubtaskSessionPane({ tabId, subtaskId, parentTaskId, fallbackCwd }: { tabId: string; subtaskId: string; parentTaskId: string; fallbackCwd: string | null }) {
	const t = useT()
	const sessionName = useTabsStore((s) => s.claudeSessionByTab[tabId])
	const modelLabel = useTabsStore((s) => s.claudeModelByTab[tabId])
	const setClaudeSession = useTabsStore((s) => s.setClaudeSession)
	const subtask = useSessionsStore((s) => {
		const allTasks = [...s.inbox, ...s.folders.flatMap((f) => f.tasks)]
		return allTasks.find((t) => t.id === parentTaskId)?.subtasks.find((st) => st.id === subtaskId) ?? null
	})
	const [liveSession, setLiveSession] = useState<string | null>(null)
	const [liveCwd, setLiveCwd] = useState<string | null>(null)
	const [checked, setChecked] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const startedRef = useRef(false)

	// "완료했을때 세션에 접속하면 새로운 세션이 추가되고있어 — 이전에 완료된 그 세션에 접속되어야해"
	// — st.alive는 done(ended_at 찍힘)이면 항상 false라, "완료된 서브태스크"를 다시 열 때마다 여기서
	// 매번 새 즉석 세션을 만들어버렸다(아래 두 번째 useEffect, 원래는 "아직 워크트리조차 없는" 경우를
	// 위한 폴백). tmuxSession/worktreePath는 완료된 서브태스크에도 그대로 남아있으니(§ getSubtaskWorkState)
	// alive 여부와 무관하게 그 실제 세션·워크트리로 접속한다 — 새로 만드는 건 정말 한 번도 시작 안 한
	// 경우(아래 폴백)뿐이어야 한다.
	useEffect(() => {
		let cancelled = false
		getSubtaskWorkState(parentTaskId)
			.then((r) => {
				if (cancelled || !r.ok) return
				const st = r.subtasks.find((x) => x.id === subtaskId)
				if (st?.tmuxSession && st.worktreePath) {
					setLiveSession(st.tmuxSession)
					setLiveCwd(st.worktreePath)
				}
			})
			.finally(() => !cancelled && setChecked(true))
		return () => {
			cancelled = true
		}
	}, [parentTaskId, subtaskId])

	useEffect(() => {
		if (!checked || liveSession || sessionName || startedRef.current) return
		if (!fallbackCwd) {
			setError(t('워크트리가 아직 없고, 대체할 레포 경로도 찾지 못했습니다.'))
			return
		}
		startedRef.current = true
		const seed = `[서브태스크 세션] "${subtask?.name || ''}"에 대해 이야기해줘 — 아직 이 서브태스크 전용 워크트리는 없다(태스크 상세에서 "개발 시작"을 누르면 생긴다).${subtask?.desc ? ' ' + subtask.desc : ''}`
		createTerm({ cwd: fallbackCwd, command: 'claude', label: subtask?.name || 'subtask', seed })
			.then((r) => {
				if (r.ok) setClaudeSession(tabId, r.name, r.modelLabel)
				else setError(t(r.error || '세션 생성 실패'))
			})
			.catch((e) => setError(e instanceof Error ? e.message : String(e)))
	}, [checked, liveSession, sessionName, fallbackCwd, subtask, tabId, setClaudeSession])

	if (liveSession && liveCwd) return <XTerm session={liveSession} cwd={liveCwd} modelLabel={null} />
	if (sessionName) return <XTerm session={sessionName} cwd={fallbackCwd || ''} modelLabel={modelLabel} />
	if (error)
		return (
			<div className={styles.stub}>
				<div className={styles.stubTitle}>{t('세션을 시작하지 못했습니다')}</div>
				<div className={styles.stubError}>{error}</div>
			</div>
		)
	return (
		<div className={styles.stub}>
			<div className={styles.stubTitle}>{t('서브태스크 세션 확인 중…')}</div>
		</div>
	)
}

const KIND_OPT: { id: Task['kind']; label: string }[] = [
	{ id: 'single', label: 'single' },
	{ id: 'chain', label: 'chain(이어서)' },
	{ id: 'parallel', label: 'parallel(동시에)' },
]

// 일감함(inbox)의 일감은 누른다고 바로 등록되지 않는다 — 먼저 내용을 훑어보고, 여기서 명시적으로
// "태스크로 등록"해야 실제 태스크가 되어 트리로 내려가고(quickStartTask) 워크트리·세션이 자동으로 뜬다.
//
// mainTask 생성 확인 단계(§12) — "AI 제안 + 사람이 자유롭게 덮어쓰기". 처음 만드는 사람에게 전부
// 보여주고 직접 결정하게 하되, 매번 처음부터 다 채우면 번거로우니 AI/제품 기본값을 미리 채워두고
// "기본 접힘 고급 설정" 패턴으로 감싼다 — 평소엔 한 줄 요약만 보고 바로 등록, 세밀하게 통제하고 싶으면 펼침.
function InboxPreview({ task }: { task: Task }) {
	const t = useT()
	const quickStartTask = useSessionsStore((s) => s.quickStartTask)
	const quickStartBusy = useSessionsStore((s) => s.quickStartBusy === task.id)
	const repos = useSessionsStore((s) => s.repos)
	const rootPath = useSessionsStore((s) => s.rootPath)
	const multiRepo = repos.length > 1

	const [open, setOpen] = useState(false)
	// 'main'으로 미리 채워두면 안 건드려도 그대로 전송돼 백엔드(worktrees.cjs)의 base 자동감지(레포
	// 설정 → 현재 체크아웃 브랜치 → 최후수단 'main')를 항상 덮어써버렸다 — 손대지 않으면 빈 값을 보내
	// 백엔드가 그 레포에 맞는 base를 스스로 찾게 둔다.
	const [base, setBase] = useState('')
	const [autoMerge, setAutoMerge] = useState(false)
	const [retryLimit, setRetryLimit] = useState(3)
	const [kind, setKind] = useState<Task['kind']>(task.kind || 'single')
	const [repoId, setRepoId] = useState<string | null>(task.repo_id ?? (repos[0]?.id ?? null))
	const [startPrompt, setStartPrompt] = useState(task.start_prompt || task.name)

	const repoName = multiRepo ? repos.find((r) => r.id === repoId)?.name || t('(선택 안 함)') : repos[0]?.name || rootPath?.split('/').pop() || t('단일 레포')

	function commit() {
		quickStartTask(task.id, { base, autoMerge, retryLimit, kind, repoId: multiRepo ? repoId : undefined, startPrompt })
	}

	return (
		<div className={styles.stub}>
			<div className={styles.stubTitle}>{task.name}</div>
			<div className={styles.stubSub}>{task.desc || t('설명 없음')}</div>
			<div className={styles.confirmSummary} onClick={() => setOpen((o) => !o)}>
				{repoName} · {base || t('자동감지')} · {t('자동머지')} {autoMerge ? 'on' : 'off'} · N={retryLimit} {open ? '▾' : t('▸ 자세히')}
			</div>
			{open && (
				<div className={styles.confirmForm} onClick={(e) => e.stopPropagation()}>
					{multiRepo && (
						<div className={styles.confirmRow}>
							<span className={styles.confirmLabel}>{t('레포')}</span>
							<select className="fin m" style={{ width: 160, height: 26, fontSize: 10.5 }} value={repoId ?? ''} onChange={(e) => setRepoId(e.target.value || null)}>
								<option value="">{t('(선택 안 함)')}</option>
								{repos.map((r) => (
									<option key={r.id} value={r.id}>
										{r.name}
									</option>
								))}
							</select>
						</div>
					)}
					<div className={styles.confirmRow}>
						<span className={styles.confirmLabel}>{t('base 브랜치')}</span>
						<input
							className="fin m"
							style={{ width: 160, height: 26, fontSize: 10.5 }}
							value={base}
							onChange={(e) => setBase(e.target.value)}
							placeholder={t('자동감지')}
						/>
					</div>
					<div className={styles.confirmRow}>
						<span className={styles.confirmLabel}>{t('자동 머지 정책')}</span>
						<label className="m" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5 }}>
							<input type="checkbox" checked={autoMerge} onChange={(e) => setAutoMerge(e.target.checked)} />
							Auto-merge
						</label>
					</div>
					<div className={styles.confirmRow}>
						<span className={styles.confirmLabel}>{t('첫 subTask kind')}</span>
						<select className="fin m" style={{ width: 160, height: 26, fontSize: 10.5 }} value={kind} onChange={(e) => setKind(e.target.value as Task['kind'])}>
							{KIND_OPT.map((k) => (
								<option key={k.id} value={k.id}>
									{t(k.label)}
								</option>
							))}
						</select>
					</div>
					<div className={styles.confirmRow}>
						<span className={styles.confirmLabel}>{t('재시도 횟수(N)')}</span>
						<input
							className="fin m"
							type="number"
							min={1}
							style={{ width: 160, height: 26, fontSize: 10.5 }}
							value={retryLimit}
							onChange={(e) => setRetryLimit(Math.max(1, Number(e.target.value) || 1))}
						/>
					</div>
					<div>
						<div className={styles.confirmLabel} style={{ marginBottom: 4 }}>
							start_prompt
						</div>
						<textarea className={`fin m ${styles.confirmPrompt}`} value={startPrompt} onChange={(e) => setStartPrompt(e.target.value)} />
					</div>
				</div>
			)}
			<button className={styles.stubBtn} disabled={quickStartBusy} onClick={commit}>
				{quickStartBusy ? t('등록 중…') : t('태스크로 등록')}
			</button>
		</div>
	)
}

function NoSessionStub({ folderKind }: { folderKind: boolean }) {
	const t = useT()
	return (
		<div className={styles.stub}>
			<div className={styles.stubTitle}>{t(folderKind ? '아직 지휘자 세션이 없습니다' : '아직 워크트리가 없습니다')}</div>
			<div className={styles.stubSub}>
				{t(folderKind ? '오케스트레이터 탭에서 "대화 시작"을 눌러 지휘자 세션을 먼저 띄우세요.' : '서브태스크가 이 태스크에 들어가는 순간 오케스트레이터가 자동으로 워크트리·세션을 만듭니다.')}
			</div>
		</div>
	)
}

// 트리 노드는 두 종류다 — 태스크(=실제 Folder, 클릭하면 기본 "오케스트레이터" 탭) / 서브태스크
// (=실제 Task, 클릭하면 기본 "터미널" 탭). activeNodeId 하나로 다루되, 어느 쪽인지에 따라 탭 구성과
// 콘텐츠가 달라진다.
export default function TabWorkspace() {
	// 이 컴포넌트는 탭 인스턴스 변수명으로 `t`를 이미 광범위하게 쓰고 있어(tabs.map((t) => ...) 등)
	// useT()의 번역 함수는 `tr`로 별도 이름을 준다 — `t`로 하면 안쪽 콜백/함수에서 탭 인스턴스에
	// 가려져(shadowing) 번역 함수를 못 부르게 된다.
	const tr = useT()
	const activeNodeId = useTabsStore((s) => s.activeNodeId)
	const tabsByNode = useTabsStore((s) => s.tabsByNode)
	const activeTabByNode = useTabsStore((s) => s.activeTabByNode)
	const rightTabIdsByNode = useTabsStore((s) => s.rightTabIdsByNode)
	const activeRightTabByNode = useTabsStore((s) => s.activeRightTabByNode)
	const openTab = useTabsStore((s) => s.openTab)
	const closeTab = useTabsStore((s) => s.closeTab)
	const reopenLastClosed = useTabsStore((s) => s.reopenLastClosed)
	const cycleTab = useTabsStore((s) => s.cycleTab)
	const setActiveTab = useTabsStore((s) => s.setActiveTab)
	const renameTab = useTabsStore((s) => s.renameTab)
	const moveTabToRight = useTabsStore((s) => s.moveTabToRight)
	const moveTabToLeft = useTabsStore((s) => s.moveTabToLeft)
	const setActiveRightTab = useTabsStore((s) => s.setActiveRightTab)
	const openTabInRight = useTabsStore((s) => s.openTabInRight)
	// "탭도 반으로 나뉘어야해. vscode처럼" — 탭바에서 드래그가 진행 중인 탭 id + 지금 그 탭이 어느
	// 그룹(왼쪽/오른쪽) 소속인지. 드래그 중일 때만 반대쪽 탭바·드롭존이 하이라이트된다.
	const [dragTab, setDragTab] = useState<{ id: string; from: 'left' | 'right' } | null>(null)
	// 네이티브 HTML5 dragenter/dragleave는 자식 요소를 오갈 때도 반복 발화해 하이라이트가 깜빡인다
	// ("탭 드래그앤드롭이 자연스럽지 않아"의 큰 원인) — 표준 카운터 패턴으로 진짜 벗어났을 때만 끈다.
	const dragCounters = useRef<Record<string, number>>({})
	const [dragOverZone, setDragOverZone] = useState<string | null>(null)
	function dragEnterZone(zone: string) {
		dragCounters.current[zone] = (dragCounters.current[zone] ?? 0) + 1
		setDragOverZone(zone)
	}
	function dragLeaveZone(zone: string) {
		dragCounters.current[zone] = Math.max(0, (dragCounters.current[zone] ?? 0) - 1)
		if (dragCounters.current[zone] === 0) setDragOverZone((z) => (z === zone ? null : z))
	}
	// "탭도 반으로 나뉘어야해" — 그룹별로 독립된 "+" 메뉴가 필요해 어느 그룹에서 열렸는지도 같이 든다.
	const [cmdkOpenGroup, setCmdkOpenGroup] = useState<'left' | 'right' | null>(null)
	const [menuForTab, setMenuForTab] = useState<string | null>(null)
	const [renamingTab, setRenamingTab] = useState<string | null>(null)
	const [renameDraft, setRenameDraft] = useState('')
	const renameInputRef = useRef<HTMLInputElement>(null)
	// "새 워크트리"는 예전엔 이름을 고정 문자열('새 워크트리 작업')로 박아 만들고 실제로 뭘 시킬지는
	// 나중에 따로 채워야 했다 — 여기서 자유 텍스트를 받아 그대로 이름 + start_prompt로 같이 심는다.
	const [newWtOpen, setNewWtOpen] = useState(false)
	const [newWtDraft, setNewWtDraft] = useState('')
	const newWtInputRef = useRef<HTMLInputElement>(null)

	const found = useSessionsStore((s) => {
		if (!activeNodeId) return null
		const folderHit = s.folders.find((f) => f.id === activeNodeId)
		if (folderHit) return { kind: 'folder' as const, folderId: folderHit.id, task: null }
		const inboxHit = s.inbox.find((t) => t.id === activeNodeId)
		if (inboxHit) return { kind: 'task' as const, folderId: null as string | null, task: inboxHit }
		for (const f of s.folders) {
			const hit = f.tasks.find((t) => t.id === activeNodeId)
			if (hit) return { kind: 'task' as const, folderId: f.id, task: hit }
		}
		return null
	})
	const orch = useSessionsStore((s) => (found?.folderId ? getOrchestration(s, found.folderId) : null))
	const folderTasks = useSessionsStore((s) => (found?.kind === 'folder' ? (s.folders.find((f) => f.id === found.folderId)?.tasks ?? []) : []))
	// "자동 선택이 안되는데?" — folder.repo_id가 정답이어야 하는데(§ types.ts Folder.repo_id 주석)
	// 실제론 비어있는 폴더가 있었다(태스크 쪽 repo_id만 채워진 채). 그러면 팀 규칙 탭이 폴더 고유
	// 레포를 못 찾고 repos[0](알파벳/등록 순 첫 레포)로 조용히 폴백해 엉뚱한 레포가 열렸다 — 폴더
	// 자체 값이 비어있으면 그 폴더 태스크들의 repo_id로 한 번 더 폴백한다.
	const folderRepoId = useSessionsStore((s) => {
		if (found?.kind !== 'folder') return null
		const f = s.folders.find((x) => x.id === found.folderId)
		if (!f) return null
		return f.repo_id ?? f.tasks.find((t) => t.repo_id)?.repo_id ?? null
	})
	const repos = useSessionsStore((s) => s.repos)
	const rootPath = useSessionsStore((s) => s.rootPath)

	const tabs = activeNodeId
		? (tabsByNode[activeNodeId] ?? (found?.kind === 'folder' ? [{ id: activeNodeId, kind: 'orchestrator' as TabKind }] : [{ id: activeNodeId, kind: 'terminal' as TabKind }]))
		: []
	// "탭도 반으로 나뉘어야해. vscode처럼" — rightTabIdsByNode에 담긴 id만 오른쪽 그룹, 나머지 전부
	// 왼쪽 그룹(기존 activeTabByNode 그대로 재사용). 오른쪽이 비어있으면(길이 0) 분할 안 된 평소 화면.
	const rightIds = activeNodeId ? (rightTabIdsByNode[activeNodeId] ?? []) : []
	const isSplit = rightIds.length > 0
	const leftTabs = isSplit ? tabs.filter((t) => !rightIds.includes(t.id)) : tabs
	const rightTabs = isSplit ? tabs.filter((t) => rightIds.includes(t.id)) : []
	const activeTabId = activeNodeId ? (activeTabByNode[activeNodeId] ?? leftTabs[0]?.id) : undefined
	const activeRightTabId = activeNodeId ? (activeRightTabByNode[activeNodeId] ?? rightTabs[0]?.id) : undefined

	// 탭 단축키 — Orca/VSCode 기본값을 따른다: Cmd/Ctrl+W 닫기, Cmd/Ctrl+Shift+T 마지막으로 닫은 탭
	// 되살리기, Ctrl+Tab(+Shift로 역방향) 탭 순환. Electron 쪽은 기본 메뉴의 Cmd+W(창 닫기) accelerator를
	// 없애서(electron/main.cjs) 여기서 preventDefault한 게 실제로 먹히게 해뒀다.
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (!activeNodeId) return
			const mod = e.metaKey || e.ctrlKey
			if (mod && !e.shiftKey && e.key.toLowerCase() === 'w') {
				if (!activeTabId) return
				e.preventDefault()
				closeTab(activeNodeId, activeTabId)
			} else if (mod && e.shiftKey && e.key.toLowerCase() === 't') {
				e.preventDefault()
				reopenLastClosed(activeNodeId)
			} else if (e.ctrlKey && e.key === 'Tab') {
				e.preventDefault()
				cycleTab(activeNodeId, e.shiftKey ? -1 : 1)
			} else if (e.metaKey && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
				e.preventDefault()
				cycleTab(activeNodeId, e.key === 'ArrowRight' ? 1 : -1)
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [activeNodeId, activeTabId, closeTab, reopenLastClosed, cycleTab])

	// "일반적인 cli 툴처럼 키 지정을 해줄수있어?" — "+" 탭 추가 패널이 열려 있을 때만 숫자키 1-9로
	// 목록 순서대로 바로 선택(fzf/lazygit류 넘버 힌트 관례). 렌더에 쓰는 addableTabs(아래, found 기반
	// 조건부 early-return 이후 선언)를 여기서 그대로 참조하면 hooks 순서 규칙에 걸려서, 같은 계산을
	// found.kind만으로 이 자리에서 다시 한다 — early-return 전이라 found가 아직 null일 수 있다.
	useEffect(() => {
		if (!cmdkOpenGroup || !activeNodeId) return
		const tabs = found?.kind === 'folder' ? ADDABLE_FOLDER_TABS : ADDABLE_TASK_TABS
		function onKeyDown(e: KeyboardEvent) {
			if (e.metaKey || e.ctrlKey || e.altKey) return
			const idx = Number(e.key) - 1
			if (!Number.isInteger(idx) || idx < 0 || idx >= tabs.length) return
			e.preventDefault()
			const tab = tabs[idx]
			if (cmdkOpenGroup === 'left') openTab(activeNodeId!, tab)
			else openTabInRight(activeNodeId!, tab)
			setCmdkOpenGroup(null)
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [cmdkOpenGroup, activeNodeId, found?.kind, openTab, openTabInRight])

	useEffect(() => {
		if (!menuForTab) return
		const onDocClick = () => setMenuForTab(null)
		document.addEventListener('click', onDocClick)
		return () => document.removeEventListener('click', onDocClick)
	}, [menuForTab])

	useEffect(() => {
		if (renamingTab) renameInputRef.current?.focus()
	}, [renamingTab])

	useEffect(() => {
		if (newWtOpen) newWtInputRef.current?.focus()
	}, [newWtOpen])

	function startRename(tabId: string, current: string) {
		setMenuForTab(null)
		setRenamingTab(tabId)
		setRenameDraft(current)
	}
	function commitRename() {
		if (activeNodeId && renamingTab) renameTab(activeNodeId, renamingTab, renameDraft)
		setRenamingTab(null)
	}

	async function commitNewWorktree(folderId: string | null) {
		const text = newWtDraft.trim()
		setNewWtOpen(false)
		setNewWtDraft('')
		setCmdkOpenGroup(null)
		if (!text) return
		const newId = await useSessionsStore.getState().createTaskInFolder(folderId, text)
		if (!newId) return
		await useSessionsStore.getState().updateTaskPrompt(newId, text)
		useSessionsStore.getState().toggleTask(newId)
	}

	if (!activeNodeId) {
		return (
			<div className={styles.empty}>
				<div className={styles.emptyIcon}>⌘</div>
				<div className={styles.emptyTitle}>{tr('왼쪽에서 태스크를 펼쳐보세요')}</div>
				<div className={styles.emptySub}>{tr('태스크를 열면 여기에 오케스트레이터 · 터미널 · 로컬 서버 · 브라우저 탭이 뜹니다')}</div>
			</div>
		)
	}
	// 크론잡/모델배정/캘린더/관제는 태스크 트리 밖의 "최상위 페이지"다 — 사이드바에서 바로 꽂히는 진입점이지
	// 여러 개를 나란히 열어두고 오가는 탭 개념이 아니라, 탭바(닫기 ×, 다른 탭과 나란히) 자체를 안 보여주고
	// 페이지 내용만 꽉 채운다. 미추적 워크트리 즉석 터미널(wtPath)은 여러 개를 동시에 열 수 있어 탭바를 유지.
	if (activeNodeId === CRONJOBS_NODE_ID || activeNodeId === MODEL_POLICY_NODE_ID || activeNodeId === CALENDAR_NODE_ID || activeNodeId === CONTROL_NODE_ID || activeNodeId === TEAM_RULES_NODE_ID) {
		return (
			<div className={styles.wrap}>
				<div className={styles.body}>
					{activeNodeId === CRONJOBS_NODE_ID && <CronJobsPane />}
					{activeNodeId === MODEL_POLICY_NODE_ID && <ModelPolicyPane />}
					{activeNodeId === CALENDAR_NODE_ID && <CalendarPane />}
					{activeNodeId === CONTROL_NODE_ID && <ControlPane />}
					{activeNodeId === TEAM_RULES_NODE_ID && <TeamRulesPane />}
				</div>
			</div>
		)
	}
	// 미추적 워크트리 즉석 터미널은 태스크 트리에 속하지 않는 전역 가짜 노드라 found가 항상 null이다 —
	// 아래 found 기반 렌더링(오케스트레이터/터미널/서버/브라우저 등)과는 무관하게 먼저 갈라낸다.
	const wtPath = wtPathFromNodeId(activeNodeId)
	if (wtPath) {
		const activeTabInstance = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
		return (
			<div className={styles.wrap}>
				<div className={styles.tabbar}>
					{tabs.map((t) => (
						<div key={t.id} className={`${styles.tab} ${t.id === activeTabId ? styles.tabActive : ''}`} onClick={() => setActiveTab(activeNodeId, t.id)}>
							<span>{t.label || tr(TAB_LABEL[t.kind])}</span>
							<span
								className={styles.tabClose}
								onClick={(e) => {
									e.stopPropagation()
									closeTab(activeNodeId, t.id)
								}}
							>
								×
							</span>
						</div>
					))}
				</div>
				<div className={styles.body}>{activeTabInstance?.kind === 'terminal' && <AdHocTerminalPane key={activeTabInstance.id} tabId={activeTabInstance.id} cwd={wtPath} />}</div>
			</div>
		)
	}

	if (!found) return null
	const isInboxItem = found.kind === 'task' && !found.task?.folder_id
	const activeTabInstance = leftTabs.find((t) => t.id === activeTabId) ?? leftTabs[0]
	const activeRightTabInstance = rightTabs.find((t) => t.id === activeRightTabId) ?? rightTabs[0]
	// 태스크(서브태스크) 노드는 자신의 오케스트레이션 세션을, 폴더(태스크) 노드는 지휘자 세션을 그
	// 자리의 "메인 세션"으로 쓴다 — 터미널/로컬 서버/브라우저/클로드 세션 탭이 공통으로 이걸 가리킨다.
	const taskSession = found.task ? (orch?.sessions.find((s) => s.taskId === found.task!.id) ?? null) : null
	const mainSession =
		found.kind === 'folder'
			? orch?.conductor
				? { tmuxSession: orch.conductor.session, worktreePath: orch.conductor.cwd, modelLabel: orch.conductor.modelLabel }
				: null
			: taskSession
	const addableTabs = found.kind === 'folder' ? ADDABLE_FOLDER_TABS : ADDABLE_TASK_TABS
	// "메인 세션과 별개의 클로드 세션"은 원래도 그 이름대로 오케스트레이터/지휘자와 무관하게 즉석에서
	// 띄우는 게 목적이라, 아직 지휘자를 시작 안 했거나(폴더) 워크트리가 없어도(서브태스크) cwd만
	// 있으면 세션을 만들 수 있어야 한다 — 멀티레포면 그 레포 경로, 아니면 단일 레포 루트로 대체.
	const fallbackRepoPath = (found.kind === 'task' && found.task?.repo_id ? repos.find((r) => r.id === found.task!.repo_id)?.path : null) ?? rootPath
	const claudeCwd = mainSession?.worktreePath ?? fallbackRepoPath ?? null
	// "환경변수 보여줘 — 지금은 빈 화면" — 폴더(메인 태스크) 노드의 mainSession.worktreePath는
	// 지휘자의 cwd(§conductorCwd)라 진짜 프로젝트가 아닌 격리된 빈 디렉토리다(터미널/클로드 세션
	// 탭엔 맞지만 .env.local이 있을 리 없다). "로컬 서버"/"브라우저" 탭은 실제 워크트리가 필요하니,
	// 폴더면 그 산하 서브태스크 중 워크트리가 있는 첫 번째 것으로, 없으면 레포 루트로 대신한다.
	const realProjectCwd = found.kind === 'folder' ? (orch?.sessions.find((s) => s.worktreePath)?.worktreePath ?? fallbackRepoPath ?? null) : claudeCwd

	// "탭 분할" — 왼쪽/오른쪽 창 둘 다 같은 종류의 콘텐츠를 그려야 해서 activeTabInstance 하나에 매인
	// 조건문 체인을 임의의 탭 인스턴스를 받는 함수로 뽑았다. tabId는 그 t.id를 그대로 넘겨(ClaudeSessionPane
	// 등은 탭 인스턴스별로 독립 세션을 갖는다) 왼쪽/오른쪽이 서로 다른 세션을 갖게 한다.
	function renderTabContent(t: TabInstance | undefined) {
		return (
			<>
				{t?.kind === 'detail' && found!.kind === 'folder' && <TaskDetailTab nodeId={activeNodeId!} tabId={t.id} folderId={found!.folderId!} />}
				{t?.kind === 'orchestrator' && found!.kind === 'folder' && <OrchestratorPane folderId={found!.folderId!} />}
				{t?.kind === 'diagram' && found!.kind === 'folder' && <TaskManagerBoard tasks={folderTasks} />}
				{/* key=folderId — 이게 없으면 다른 폴더로 넘어가도(둘 다 "팀 규칙" 탭이 활성이면) React가
				    같은 컴포넌트 인스턴스를 재사용한다. TeamRulesPane 내부 repoId는 initialRepoId가 아니라
				    "레포 선택을 수동으로 바꾼 적 있는지"만 보고 유지되므로, 폴더 A에서 다른 레포로 바꾼 뒤
				    폴더 B로 넘어가면 B의 initialRepoId(자기 레포)를 무시하고 A에서 고른 레포를 계속 보여준다. */}
				{t?.kind === 'teamRules' && found!.kind === 'folder' && <TeamRulesPane key={found!.folderId} initialRepoId={folderRepoId} folderId={found!.folderId!} />}
				{/* "태스크내에서 비서로 화면 바뀌는게 불편해서 그냥 탭에서 사용할 수 있게" — ControlPane은
				    nodeId를 안 받고 전역 비서 세션 하나를 그대로 보여주므로(§ ControlPane.tsx), 태스크
				    탭 안에 끼워 넣어도 좌측 네비의 비서(CONTROL_NODE_ID)와 완전히 같은 대화가 이어진다.
				    업무 범위(앱 전체 조작)는 그대로, 보여주는 자리만 늘어난 것. */}
				{t?.kind === 'control' && <ControlPane />}
				{/* key=t.id — 없으면 "두 개 서브태스크 탭을 바꿔도 안 바뀌는" 버그가 난다. liveSession/liveCwd가
				    로컬 state라 tabId/subtaskId prop만 바뀌어서는(React가 같은 위치·같은 컴포넌트 타입이라
				    재사용) 초기화가 안 되고 이전 탭의 세션을 계속 붙들고 있는다 — 탭 인스턴스가 바뀌면
				    아예 새 인스턴스로 마운트되게 강제한다. */}
				{t?.kind === 'subtask' && t.subtaskId && t.parentTaskId && <SubtaskSessionPane key={t.id} tabId={t.id} subtaskId={t.subtaskId} parentTaskId={t.parentTaskId} fallbackCwd={claudeCwd} />}
				{/* "터미널은 완전 별개자나" — mainSession(지휘자/서브태스크 오케스트레이션 세션)의 raw pty는
				    이미 folder면 orchestrator 탭(§ OrchestratorPane), task/subtask면 subtask 탭(§
				    SubtaskSessionPane)이 각자 따로 보여준다 — "터미널"까지 같은 세션에 붙여두면 그냥
				    중복이었다. 여기는 그 세션과 무관한 독립 빈 셸(AdHocTerminalPane, 미추적 워크트리
				    즉석 터미널과 같은 컴포넌트)로 분리한다. */}
				{t?.kind === 'terminal' &&
					(() => {
						const adHocCwd = found!.kind === 'folder' ? realProjectCwd : claudeCwd
						return (
							<div className={styles.termWrap}>
								{found!.kind === 'task' && mainSession && <SubagentStrip cwd={mainSession.worktreePath} sessionName={mainSession.tmuxSession} />}
								<div className={styles.termHost}>{adHocCwd ? <AdHocTerminalPane key={t.id} tabId={t.id} cwd={adHocCwd} /> : <NoSessionStub folderKind={found!.kind === 'folder'} />}</div>
							</div>
						)
					})()}
				{/* key=t.id — SubtaskSessionPane과 같은 버그: startedRef가 로컬 ref라 다른 클로드 세션 탭으로
				    바꿔도 "이미 시작함" 상태가 새 탭까지 이어져 그 탭은 영영 세션이 안 켜졌다. */}
				{t?.kind === 'claude' && (claudeCwd ? <ClaudeSessionPane key={t.id} tabId={t.id} cwd={claudeCwd} /> : <NoSessionStub folderKind={found!.kind === 'folder'} />)}
				{t?.kind === 'server' && (realProjectCwd ? <ServerPane cwd={realProjectCwd} /> : <NoSessionStub folderKind={found!.kind === 'folder'} />)}
				{/* folderId — "메인태스크에 보낼 수 있도록해줘"(§ BrowserPane 요소 피커→tellConductor)엔
				    진짜 폴더 id가 필요하다. taskId(=activeNodeId)는 폴더/서브태스크 어느 쪽인지 모호해서
				    쓸 수 없다 — OrchestratorPane/TeamRulesPane과 같은 자리의 found.folderId를 그대로. */}
				{t?.kind === 'browser' && <BrowserPane taskId={activeNodeId!} cwd={realProjectCwd} folderId={found!.folderId} />}
			</>
		)
	}

	// "태스크를 반으로 나누면 탭도 반으로 나뉘어야해. vscode처럼" — 탭바 자체를 그룹별로 통째로 찍어낸다.
	// 드래그 시작 그룹(dragTab.from)과 다른 그룹의 탭바에 드롭하면 그쪽으로 옮긴다(왼쪽 탭을 오른쪽
	// 탭바로 끌어놓기 등) — VSCode의 "다른 그룹 탭바에 드롭" 그대로.
	function renderTabBar(group: 'left' | 'right') {
		const groupTabs = group === 'left' ? leftTabs : rightTabs
		const groupActiveId = group === 'left' ? activeTabId : activeRightTabId
		const zone = group === 'left' ? 'left-bar' : 'right-bar'
		return (
			<div
				className={`${styles.tabbar} ${dragTab && dragTab.from !== group && dragOverZone === zone ? styles.tabbarDragOver : ''}`}
				onDragOver={(e) => {
					if (dragTab && dragTab.from !== group) e.preventDefault()
				}}
				onDragEnter={(e) => {
					if (!dragTab || dragTab.from === group) return
					e.preventDefault()
					dragEnterZone(zone)
				}}
				onDragLeave={() => dragLeaveZone(zone)}
				onDrop={(e) => {
					if (!dragTab || dragTab.from === group) return
					e.preventDefault()
					dragCounters.current[zone] = 0
					setDragOverZone(null)
					if (group === 'left') moveTabToLeft(activeNodeId!, dragTab.id)
					else moveTabToRight(activeNodeId!, dragTab.id)
					setDragTab(null)
				}}
			>
				{groupTabs.map((t) => (
					<div
						key={t.id}
						className={`${styles.tab} ${t.id === groupActiveId ? styles.tabActive : ''}`}
						draggable
						onDragStart={(e) => {
							e.dataTransfer.effectAllowed = 'move'
							e.dataTransfer.setData('text/plain', t.id)
							setDragTab({ id: t.id, from: group })
						}}
						onDragEnd={() => {
							setDragTab(null)
							setDragOverZone(null)
							dragCounters.current = {}
						}}
						onClick={() => (group === 'left' ? setActiveTab(activeNodeId!, t.id) : setActiveRightTab(activeNodeId!, t.id))}
						onContextMenu={(e) => {
							e.preventDefault()
							setMenuForTab(t.id)
						}}
					>
						{renamingTab === t.id ? (
							<input
								ref={renameInputRef}
								className={styles.tabRenameInput}
								value={renameDraft}
								onClick={(e) => e.stopPropagation()}
								onChange={(e) => setRenameDraft(e.target.value)}
								onBlur={commitRename}
								onKeyDown={(e) => {
									if (e.key === 'Enter') commitRename()
									if (e.key === 'Escape') setRenamingTab(null)
								}}
							/>
						) : (
							<>
								{TAB_ICON[t.kind] && <span className={styles.tabIcon}>{TAB_ICON[t.kind]}</span>}
								<span>{t.label || tr(TAB_LABEL[t.kind])}</span>
							</>
						)}
						<span
							className={styles.tabClose}
							onClick={(e) => {
								e.stopPropagation()
								closeTab(activeNodeId!, t.id)
							}}
						>
							×
						</span>
						{menuForTab === t.id && (
							<div className={styles.tabMenu} onClick={(e) => e.stopPropagation()}>
								<div className={styles.tabMenuItem} onClick={() => startRename(t.id, t.label || tr(TAB_LABEL[t.kind]))}>
									{tr('이름 변경')}
								</div>
							</div>
						)}
					</div>
				))}
				<div className={styles.cmdkAnchor}>
					<button className={styles.cmdkBtn} onClick={() => setCmdkOpenGroup((g) => (g === group ? null : group))} title={tr('탭 추가')}>
						+
					</button>
					{cmdkOpenGroup === group && (
						<div className={styles.cmdkPanel} onMouseLeave={() => !newWtOpen && setCmdkOpenGroup(null)}>
							{addableTabs.map((t, i) => (
								<div
									key={t}
									className={styles.cmdkItem}
									onClick={() => {
										if (group === 'left') openTab(activeNodeId!, t)
										else openTabInRight(activeNodeId!, t)
										setCmdkOpenGroup(null)
									}}
								>
									<span className={styles.cmdkItemLabel}>
										{TAB_ICON[t] && <span className={styles.tabIcon}>{TAB_ICON[t]}</span>}
										<span>{tr(TAB_LABEL[t])}</span>
									</span>
									{i < 9 && <kbd className={styles.cmdkBadge}>{i + 1}</kbd>}
								</div>
							))}
							{group === 'left' && found!.kind === 'task' && (
								<>
									<div className={styles.cmdkDivider} />
									{newWtOpen ? (
										<input
											ref={newWtInputRef}
											className={styles.tabRenameInput}
											value={newWtDraft}
											placeholder={tr('이 워크트리에서 뭘 시킬지')}
											onClick={(e) => e.stopPropagation()}
											onChange={(e) => setNewWtDraft(e.target.value)}
											onBlur={() => commitNewWorktree(found!.folderId)}
											onKeyDown={(e) => {
												if (e.key === 'Enter') commitNewWorktree(found!.folderId)
												if (e.key === 'Escape') {
													setNewWtOpen(false)
													setNewWtDraft('')
												}
											}}
										/>
									) : (
										<div
											className={styles.cmdkItem}
											onClick={(e) => {
												e.stopPropagation()
												setNewWtOpen(true)
											}}
										>
											<span>{tr('새 워크트리')}</span>
										</div>
									)}
								</>
							)}
						</div>
					)}
				</div>
			</div>
		)
	}

	// 콘텐츠 + (분할 전 왼쪽에서만) 오른쪽 가장자리 드롭존. 분할된 뒤에는 그룹 탭바끼리 직접 드래그해
	// 옮기므로(§ renderTabBar) 이 가장자리 존은 필요 없다 — "분할을 처음 만드는" 자리로만 쓴다.
	function renderGroupBody(t: TabInstance | undefined, group: 'left' | 'right') {
		return (
			<div className={styles.body}>
				{isInboxItem ? <InboxPreview task={found!.task!} /> : renderTabContent(t)}
				{group === 'left' && !isSplit && dragTab && (
					<div
						className={`${styles.splitDropZone} ${dragOverZone === 'edge' ? styles.splitDropZoneActive : ''}`}
						onDragEnter={(e) => {
							e.preventDefault()
							dragEnterZone('edge')
						}}
						onDragLeave={() => dragLeaveZone('edge')}
						onDragOver={(e) => e.preventDefault()}
						onDrop={(e) => {
							e.preventDefault()
							dragCounters.current.edge = 0
							setDragOverZone(null)
							moveTabToRight(activeNodeId!, dragTab.id)
							setDragTab(null)
						}}
					>
						<span className={styles.splitDropHint}>{tr('여기로 놓으면 오른쪽으로 분할')}</span>
					</div>
				)}
			</div>
		)
	}

	if (leftTabs.length === 0) {
		return (
			<div className={styles.wrap}>
				{renderTabBar('left')}
				<div className={styles.empty}>
					<div className={styles.emptyIcon}>⌘</div>
					<div className={styles.emptyTitle}>{tr('열린 탭이 없습니다')}</div>
					<div className={styles.emptySub}>{tr('+ 를 눌러 탭을 추가하세요')}</div>
				</div>
			</div>
		)
	}

	// "태스크를 반으로 나누면 탭도 반으로 나뉘어야해. vscode처럼" — isSplit(오른쪽 그룹에 탭이 있음)이면
	// 그룹 두 개를 좌우로, 아니면 예전처럼 왼쪽 그룹 하나만 꽉 채운다.
	if (!isSplit) {
		return (
			<div className={styles.wrap}>
				{renderTabBar('left')}
				{renderGroupBody(activeTabInstance, 'left')}
			</div>
		)
	}
	return (
		<div className={styles.wrap}>
			<div className={styles.groupsWrap}>
				<div className={styles.group}>
					{renderTabBar('left')}
					{renderGroupBody(activeTabInstance, 'left')}
				</div>
				<div className={styles.splitDivider} />
				<div className={styles.group}>
					{renderTabBar('right')}
					{renderGroupBody(activeRightTabInstance, 'right')}
				</div>
			</div>
		</div>
	)
}
