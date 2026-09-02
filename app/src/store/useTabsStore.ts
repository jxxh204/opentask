import { create } from 'zustand'

// 워크스페이스 탭 상태 — 세션 로컬(지속 저장 안 함, persist 미들웨어 없음). 탭은 트리 노드 기준으로
// 열린다. 노드는 두 종류 — 태스크(=실제 Folder, 오케스트레이션 단위)와 서브태스크(=실제 Task, 워크트리
// 단위) — 이며 같은 키 공간(둘 다 UUID)을 공유해 activeNodeId 하나로 다룬다. 태스크를 열면 기본
// "오케스트레이터" 탭, 서브태스크를 열면 기본 "터미널" 탭으로 시작한다.
//
// VSCode처럼 탭은 종류당 하나가 아니다 — "+"를 누를 때마다 항상 새 탭 인스턴스가 생기고(TabInstance.id
// 로 구분), ×로 닫으면 사라진다. TabKind는 그 탭이 무슨 콘텐츠를 보여줄지만 정할 뿐 유일 키가 아니다.
export type TabKind = 'orchestrator' | 'diagram' | 'detail' | 'subtask' | 'terminal' | 'server' | 'browser' | 'claude' | 'cronjobs' | 'modelPolicy' | 'calendar' | 'control' | 'teamRules'

// kind 값 자체(orchestrator)는 그대로 둔다 — server/orchestrator.cjs·conductor 등 실제 백엔드 개념과
// 이름이 묶여 있어 여기서 바꾸면 득 없이 넓게 손대야 한다. 화면에 보이는 이름만 "태스크 매니저"로.
export const TAB_LABEL: Record<TabKind, string> = {
	orchestrator: '태스크 매니저',
	diagram: '다이어그램',
	detail: '상세',
	subtask: '서브태스크',
	terminal: '터미널',
	server: '로컬 서버',
	browser: '브라우저',
	claude: '클로드 세션',
	cronjobs: '크론잡',
	modelPolicy: '모델 배정',
	calendar: '캘린더',
	control: '하이브마인드',
	teamRules: '팀 규칙',
}

// 크론잡/모델배정/캘린더처럼 태스크·워크트리에 속하지 않는 전역 메뉴는 트리 노드와 같은 탭 인프라
// (tabsByNode 등)를 재사용하기 위해 실제 노드 id가 아닌 고정 가짜 id를 하나씩 배정해 쓴다("규칙:
// 모든 메뉴는 탭에서 나온다" — 별도 라우트/레거시 듀얼레일 Shell·모달 안 서브섹션으로 넣지 않는다).
export const CRONJOBS_NODE_ID = '__cronjobs__'
export const MODEL_POLICY_NODE_ID = '__modelPolicy__'
export const CALENDAR_NODE_ID = '__calendar__'
// 태스크 지휘자(orchestrator)와 이름·자리를 분리한 "비서" 에이전트(구 "관제") — 태스크 하나가 아니라
// 앱 전체(캘린더/크론잡/설정)를 대화로 조작한다(server/control.cjs — 내부 파일·심볼명은 그대로 둠).
export const CONTROL_NODE_ID = '__control__'
// "태스크 매니저처럼 팀 규칙도 탭으로" — 모델 배정과 같은 패턴(설정 모달엔 진입 링크 한 줄만, 실제
// 화면은 독립 전역 탭). 레포별 브랜치·문서 규칙(§ db.cjs v22)을 여기서 관리한다.
export const TEAM_RULES_NODE_ID = '__teamRules__'

// 워크트리 목록에서 "미추적" 워크트리를 클릭하면 여는 즉석 터미널 탭 — OpenTask가 태스크로 추적하지
// 않는 경로라 UUID 노드가 없다. 경로 자체를 가짜 노드 id로 삼는다(경로마다 별도 탭 세트 유지).
const WT_NODE_PREFIX = '__wt__'
export function wtNodeId(path: string) {
	return WT_NODE_PREFIX + path
}
export function wtPathFromNodeId(nodeId: string) {
	return nodeId.startsWith(WT_NODE_PREFIX) ? nodeId.slice(WT_NODE_PREFIX.length) : null
}

export interface TabInstance {
	id: string
	kind: TabKind
	label?: string // 우클릭 "이름 변경"으로 덮어쓴 커스텀 라벨 — 없으면 TAB_LABEL[kind]
	// kind === 'subtask' 전용 — 다이어그램에서 서브태스크 박스를 눌러 열 때만 채워진다.
	subtaskId?: string
	parentTaskId?: string
}

function genTabId() {
	return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface TabsState {
	activeNodeId: string | null
	tabsByNode: Record<string, TabInstance[]>
	activeTabByNode: Record<string, string>
	// "태스크를 반으로 나누면 탭도 반으로 나뉘어야해. vscode처럼" — 단일 탭을 오른쪽에 고정만 하던
	// 이전 방식(splitTabByNode) 대신, VSCode 에디터 그룹처럼 진짜 두 번째 탭 그룹을 둔다. 이 배열에
	// 담긴 탭 id는 "오른쪽 그룹" 소속 — tabsByNode의 순서·존재 자체는 그대로 두고 소속만 여기로 갈라
	// 관리한다(탭을 지우거나 다시 부를 때 로직을 하나로 유지하기 위함). 비어있으면 분할 안 된 상태 —
	// 왼쪽(activeTabByNode) 하나만 쓰던 이전 화면 그대로 보인다.
	rightTabIdsByNode: Record<string, string[]>
	activeRightTabByNode: Record<string, string>
	// Cmd/Ctrl+Shift+T(VSCode 기본) — 닫은 탭을 노드별 스택으로 보관, 마지막 것부터 되살린다.
	closedByNode: Record<string, TabInstance[]>
	// "클로드 세션" 탭은 매 인스턴스가 독립된 tmux 세션이다(Term.create는 detached라 탭을 닫아도
	// 세션 자체는 살아있음) — 탭 인스턴스 id로 키를 잡아 여러 개를 동시에 추적한다.
	claudeSessionByTab: Record<string, string>
	// 세션 생성 시 서버(term.cjs)가 자동 배분한 모델 — 탭을 다른 곳으로 갔다 와도 배지가 유지되게
	// 컴포넌트 로컬 state가 아니라 여기 저장한다.
	claudeModelByTab: Record<string, string | null>

	setActiveNode(id: string, defaultTab: TabKind): void
	openTab(id: string, kind: TabKind): void
	openOrFocusTab(id: string, kind: TabKind): void
	openSubtaskTab(id: string, subtaskId: string, parentTaskId: string, label: string): void
	closeTab(id: string, tabId: string): void
	reopenLastClosed(id: string): void
	setActiveTab(id: string, tabId: string): void
	cycleTab(id: string, dir: 1 | -1): void
	renameTab(id: string, tabId: string, label: string): void
	setClaudeSession(tabId: string, name: string, modelLabel: string | null): void
	// 오른쪽 그룹으로/에서 옮기기 — 드래그로 탭바 자체를 끌어다 놓을 때 호출.
	moveTabToRight(id: string, tabId: string): void
	moveTabToLeft(id: string, tabId: string): void
	setActiveRightTab(id: string, tabId: string): void
	openTabInRight(id: string, kind: TabKind): void

	// "도킹패널" — 하이브마인드를 사이드바 nav로 열면 지금 보던 폴더의 탭 전체가 다른 노드(__control__)로
	// 바뀌어 현재 작업 화면이 통째로 사라졌다("새로운 창으로 넘어가는" 느낌). 탭으로 노드를 바꾸는 대신
	// 지금 워크스페이스 오른쪽에 얹는 독립 패널로 뜯어낸다 — 노드/탭과 무관하게 항상 열고 닫을 수 있다.
	controlDockOpen: boolean
	openControlDock(): void
	closeControlDock(): void
	toggleControlDock(): void
	// "너무 작아" — 고정폭 380px이 너무 좁다는 피드백으로 드래그 리사이즈 추가. 폭을 여기 저장해둬야
	// 패널을 접었다 다시 펴도(재마운트) 마지막으로 맞춘 크기가 유지된다.
	controlDockWidth: number
	setControlDockWidth(width: number): void
}

export const useTabsStore = create<TabsState>()((set, get) => ({
	activeNodeId: null,
	tabsByNode: {},
	activeTabByNode: {},
	rightTabIdsByNode: {},
	activeRightTabByNode: {},
	closedByNode: {},
	claudeSessionByTab: {},
	claudeModelByTab: {},
	controlDockOpen: false,
	controlDockWidth: 520,

	setActiveNode: (id, defaultTab) => {
		set((s) => {
			const existing = s.tabsByNode[id]
			if (existing) return { activeNodeId: id }
			const first: TabInstance = { id: genTabId(), kind: defaultTab }
			// "메인태스크 누르면 이제 메인태스크의 상세페이지가 탭으로 나와야한다" — 폴더(메인 태스크)
			// 노드를 처음 열 때 태스크 매니저·다이어그램과 함께 상세 탭도 같이 만들어두고, 실제로 화면에
			// 보이는(활성) 탭은 상세로 시작한다("+"로 매번 열 필요 없이 클릭만 하면 바로 상세가 보이게).
			const detailTab: TabInstance = { id: genTabId(), kind: 'detail' }
			// "기본으로 켜져있도록 해줘" — 팀 규칙도 상세·다이어그램처럼 폴더를 처음 열 때 같이 만들어둔다
			// (활성 탭은 여전히 상세 — 팀 규칙은 매번 보는 화면은 아니라 포커스까진 안 가져간다).
			const seeded = defaultTab === 'orchestrator' ? [detailTab, first, { id: genTabId(), kind: 'diagram' as TabKind }, { id: genTabId(), kind: 'teamRules' as TabKind }] : [first]
			const activeId = defaultTab === 'orchestrator' ? detailTab.id : first.id
			return {
				activeNodeId: id,
				tabsByNode: { ...s.tabsByNode, [id]: seeded },
				activeTabByNode: { ...s.activeTabByNode, [id]: activeId },
			}
		})
	},

	openTab: (id, kind) => {
		set((s) => {
			const tabs = s.tabsByNode[id] ?? []
			const next: TabInstance = { id: genTabId(), kind }
			return {
				tabsByNode: { ...s.tabsByNode, [id]: [...tabs, next] },
				activeTabByNode: { ...s.activeTabByNode, [id]: next.id },
			}
		})
	},

	// "서브태스크 내에 설정된 메인태스크를 누르면 메인태스크 다이어그램으로 넘어가서" — 이미 그 종류의
	// 탭이 열려 있으면 새로 안 만들고 그걸로 전환만 한다(다이어그램 탭은 setActiveNode가 기본으로
	// 이미 만들어두므로 대개 이 경로를 탄다).
	openOrFocusTab: (id, kind) => {
		set((s) => {
			const tabs = s.tabsByNode[id] ?? []
			const existing = tabs.find((t) => t.kind === kind)
			if (existing) return { activeTabByNode: { ...s.activeTabByNode, [id]: existing.id } }
			const next: TabInstance = { id: genTabId(), kind }
			return {
				tabsByNode: { ...s.tabsByNode, [id]: [...tabs, next] },
				activeTabByNode: { ...s.activeTabByNode, [id]: next.id },
			}
		})
	},

	// "모든 서브태스크는 클릭해서 탭을 추가할 수 있고... 탭 리스트는 메인태스크 기준으로" — 다이어그램의
	// 서브태스크 박스를 누르면 그 서브태스크의 메인 태스크(=폴더) 노드의 탭 리스트에 탭이 하나 추가된다.
	// 같은 서브태스크를 다시 누르면 새로 안 열고 이미 열린 탭으로만 전환한다(중복 탭 방지).
	openSubtaskTab: (id, subtaskId, parentTaskId, label) => {
		set((s) => {
			const tabs = s.tabsByNode[id] ?? []
			const existing = tabs.find((t) => t.kind === 'subtask' && t.subtaskId === subtaskId)
			if (existing) return { activeTabByNode: { ...s.activeTabByNode, [id]: existing.id } }
			const next: TabInstance = { id: genTabId(), kind: 'subtask', subtaskId, parentTaskId, label }
			return {
				tabsByNode: { ...s.tabsByNode, [id]: [...tabs, next] },
				activeTabByNode: { ...s.activeTabByNode, [id]: next.id },
			}
		})
	},

	closeTab: (id, tabId) => {
		const s = get()
		const closing = (s.tabsByNode[id] ?? []).find((t) => t.id === tabId)
		const tabs = (s.tabsByNode[id] ?? []).filter((t) => t.id !== tabId)
		const rightIds = (s.rightTabIdsByNode[id] ?? []).filter((x) => x !== tabId)
		const wasRight = (s.rightTabIdsByNode[id] ?? []).includes(tabId)
		const leftTabs = tabs.filter((t) => !rightIds.includes(t.id))
		const rightTabs = tabs.filter((t) => rightIds.includes(t.id))
		const wasActiveLeft = !wasRight && s.activeTabByNode[id] === tabId
		const wasActiveRight = wasRight && s.activeRightTabByNode[id] === tabId
		set({
			tabsByNode: { ...s.tabsByNode, [id]: tabs },
			activeTabByNode: wasActiveLeft ? { ...s.activeTabByNode, [id]: leftTabs[leftTabs.length - 1]?.id ?? '' } : s.activeTabByNode,
			// 오른쪽 그룹(§ "탭도 반으로 나뉘어야해")에서 탭이 닫히면 그 그룹 안에서만 다음 탭으로 넘기고,
			// 그룹이 통째로 비면 rightTabIdsByNode도 비어 자연히 분할이 접힌다(빈 오른쪽 창이 안 남음).
			rightTabIdsByNode: wasRight ? { ...s.rightTabIdsByNode, [id]: rightIds } : s.rightTabIdsByNode,
			activeRightTabByNode: wasActiveRight ? { ...s.activeRightTabByNode, [id]: rightTabs[rightTabs.length - 1]?.id ?? '' } : s.activeRightTabByNode,
			closedByNode: closing ? { ...s.closedByNode, [id]: [...(s.closedByNode[id] ?? []), closing] } : s.closedByNode,
		})
	},

	reopenLastClosed: (id) => {
		const s = get()
		const stack = s.closedByNode[id] ?? []
		if (!stack.length) return
		const restored = stack[stack.length - 1]
		const tabs = s.tabsByNode[id] ?? []
		set({
			tabsByNode: { ...s.tabsByNode, [id]: [...tabs, restored] },
			activeTabByNode: { ...s.activeTabByNode, [id]: restored.id },
			closedByNode: { ...s.closedByNode, [id]: stack.slice(0, -1) },
		})
	},

	setActiveTab: (id, tabId) => set((s) => ({ activeTabByNode: { ...s.activeTabByNode, [id]: tabId } })),

	cycleTab: (id, dir) => {
		const s = get()
		const tabs = s.tabsByNode[id] ?? []
		if (tabs.length < 2) return
		const curIdx = tabs.findIndex((t) => t.id === s.activeTabByNode[id])
		const nextIdx = (curIdx + dir + tabs.length) % tabs.length
		set({ activeTabByNode: { ...s.activeTabByNode, [id]: tabs[nextIdx].id } })
	},

	renameTab: (id, tabId, label) => {
		set((s) => ({
			tabsByNode: {
				...s.tabsByNode,
				[id]: (s.tabsByNode[id] ?? []).map((t) => (t.id === tabId ? { ...t, label: label.trim() || undefined } : t)),
			},
		}))
	},

	setClaudeSession: (tabId, name, modelLabel) =>
		set((s) => ({
			claudeSessionByTab: { ...s.claudeSessionByTab, [tabId]: name },
			claudeModelByTab: { ...s.claudeModelByTab, [tabId]: modelLabel },
		})),

	// "탭도 반으로 나뉘어야해. vscode처럼" — 왼쪽 그룹에 있던 탭을 오른쪽 그룹으로 옮긴다. 왼쪽에 남는
	// 탭이 하나도 없어지면(=지금 이 탭이 왼쪽의 유일한 탭) 왼쪽이 텅 빈 채로 분할되는 어색한 상태라
	// 그 경우는 조용히 무시한다.
	moveTabToRight: (id, tabId) => {
		const s = get()
		const rightIds = s.rightTabIdsByNode[id] ?? []
		if (rightIds.includes(tabId)) return
		const leftTabs = (s.tabsByNode[id] ?? []).filter((t) => !rightIds.includes(t.id) && t.id !== tabId)
		if (leftTabs.length === 0) return
		const wasActiveLeft = s.activeTabByNode[id] === tabId
		set({
			rightTabIdsByNode: { ...s.rightTabIdsByNode, [id]: [...rightIds, tabId] },
			activeRightTabByNode: { ...s.activeRightTabByNode, [id]: tabId },
			// 옮긴 탭이 왼쪽에서 활성 탭이었으면 왼쪽 활성 탭을 남은 탭 중 하나로 다시 잡아준다.
			activeTabByNode: wasActiveLeft ? { ...s.activeTabByNode, [id]: leftTabs[leftTabs.length - 1].id } : s.activeTabByNode,
		})
	},
	// 오른쪽 그룹의 탭을 왼쪽으로 되돌린다 — 오른쪽 그룹이 비면 rightTabIdsByNode도 비어 분할이 자연히
	// 접힌다(렌더 쪽은 그 배열 길이만 본다).
	moveTabToLeft: (id, tabId) => {
		const s = get()
		const rightIds = (s.rightTabIdsByNode[id] ?? []).filter((x) => x !== tabId)
		const wasActiveRight = s.activeRightTabByNode[id] === tabId
		const rightTabs = (s.tabsByNode[id] ?? []).filter((t) => rightIds.includes(t.id))
		set({
			rightTabIdsByNode: { ...s.rightTabIdsByNode, [id]: rightIds },
			activeRightTabByNode: wasActiveRight ? { ...s.activeRightTabByNode, [id]: rightTabs[rightTabs.length - 1]?.id ?? '' } : s.activeRightTabByNode,
			activeTabByNode: { ...s.activeTabByNode, [id]: tabId },
		})
	},
	setActiveRightTab: (id, tabId) => set((s) => ({ activeRightTabByNode: { ...s.activeRightTabByNode, [id]: tabId } })),
	// 오른쪽 그룹 전용 "+" — 왼쪽과 똑같이 새 탭 인스턴스를 만들되 소속만 오른쪽으로 바로 넣는다.
	openTabInRight: (id, kind) => {
		set((s) => {
			const tabs = s.tabsByNode[id] ?? []
			const next: TabInstance = { id: genTabId(), kind }
			return {
				tabsByNode: { ...s.tabsByNode, [id]: [...tabs, next] },
				rightTabIdsByNode: { ...s.rightTabIdsByNode, [id]: [...(s.rightTabIdsByNode[id] ?? []), next.id] },
				activeRightTabByNode: { ...s.activeRightTabByNode, [id]: next.id },
			}
		})
	},

	openControlDock: () => set({ controlDockOpen: true }),
	closeControlDock: () => set({ controlDockOpen: false }),
	toggleControlDock: () => set((s) => ({ controlDockOpen: !s.controlDockOpen })),
	setControlDockWidth: (width) => set({ controlDockWidth: Math.round(width) }),
}))
