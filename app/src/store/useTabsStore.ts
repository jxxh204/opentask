import { create } from 'zustand'

// 워크스페이스 탭 상태 — 세션 로컬(지속 저장 안 함, persist 미들웨어 없음). 탭은 트리 노드 기준으로
// 열린다. 노드는 두 종류 — 태스크(=실제 Folder, 오케스트레이션 단위)와 서브태스크(=실제 Task, 워크트리
// 단위) — 이며 같은 키 공간(둘 다 UUID)을 공유해 activeNodeId 하나로 다룬다. 태스크를 열면 기본
// "오케스트레이터" 탭, 서브태스크를 열면 기본 "터미널" 탭으로 시작한다.
//
// VSCode처럼 탭은 종류당 하나가 아니다 — "+"를 누를 때마다 항상 새 탭 인스턴스가 생기고(TabInstance.id
// 로 구분), ×로 닫으면 사라진다. TabKind는 그 탭이 무슨 콘텐츠를 보여줄지만 정할 뿐 유일 키가 아니다.
export type TabKind = 'orchestrator' | 'terminal' | 'server' | 'browser' | 'claude' | 'cronjobs' | 'modelPolicy'

export const TAB_LABEL: Record<TabKind, string> = {
	orchestrator: '오케스트레이터',
	terminal: '터미널',
	server: '로컬 서버',
	browser: '브라우저',
	claude: '클로드 세션',
	cronjobs: '크론잡',
	modelPolicy: '모델 배정',
}

// 크론잡/모델배정처럼 태스크·워크트리에 속하지 않는 전역 메뉴는 트리 노드와 같은 탭 인프라
// (tabsByNode 등)를 재사용하기 위해 실제 노드 id가 아닌 고정 가짜 id를 하나씩 배정해 쓴다("규칙:
// 모든 메뉴는 탭에서 나온다" — 별도 라우트/레거시 듀얼레일 Shell·모달 안 서브섹션으로 넣지 않는다).
export const CRONJOBS_NODE_ID = '__cronjobs__'
export const MODEL_POLICY_NODE_ID = '__modelPolicy__'

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
}

function genTabId() {
	return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface TabsState {
	activeNodeId: string | null
	tabsByNode: Record<string, TabInstance[]>
	activeTabByNode: Record<string, string>
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
	closeTab(id: string, tabId: string): void
	reopenLastClosed(id: string): void
	setActiveTab(id: string, tabId: string): void
	cycleTab(id: string, dir: 1 | -1): void
	renameTab(id: string, tabId: string, label: string): void
	setClaudeSession(tabId: string, name: string, modelLabel: string | null): void
}

export const useTabsStore = create<TabsState>()((set, get) => ({
	activeNodeId: null,
	tabsByNode: {},
	activeTabByNode: {},
	closedByNode: {},
	claudeSessionByTab: {},
	claudeModelByTab: {},

	setActiveNode: (id, defaultTab) => {
		set((s) => {
			const existing = s.tabsByNode[id]
			if (existing) return { activeNodeId: id }
			const first: TabInstance = { id: genTabId(), kind: defaultTab }
			return {
				activeNodeId: id,
				tabsByNode: { ...s.tabsByNode, [id]: [first] },
				activeTabByNode: { ...s.activeTabByNode, [id]: first.id },
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

	closeTab: (id, tabId) => {
		const s = get()
		const closing = (s.tabsByNode[id] ?? []).find((t) => t.id === tabId)
		const tabs = (s.tabsByNode[id] ?? []).filter((t) => t.id !== tabId)
		const wasActive = s.activeTabByNode[id] === tabId
		set({
			tabsByNode: { ...s.tabsByNode, [id]: tabs },
			activeTabByNode: wasActive ? { ...s.activeTabByNode, [id]: tabs[tabs.length - 1]?.id ?? '' } : s.activeTabByNode,
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
}))
