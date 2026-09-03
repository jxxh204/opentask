import { create } from 'zustand'
import { useBrowserNavStore } from './useBrowserNavStore'

// "캘린더에서 스토리북 링크를 누르면 탭으로 넘어가서 다시 돌아오기 귀찮아지는데 크롬의 탭 폴더관리
// 처럼 탭 모둠으로 전역 탭관리하면 어떨지" — useTabsStore의 탭은 전부 노드(폴더/태스크) 소속이라,
// 다른 노드의 링크를 보려면 activeNodeId 자체를 바꿔야 했다(§ StatusBoard.tsx openVerifyUrl의 이전
// 버전 — "확인하기 눌러도 반응 없음" 버그를 고치려 setActiveNode를 넣었더니 이번엔 "원래 보던 캘린더가
// 사라진다"는 새 불만이 나왔다). 여기는 그 반대 축 — 노드에 안 묶인, 화면 전체에 항상 떠 있는 크롬
// 탭 스트립 하나. tabs가 비어 있으면 SessionShell이 이 스트립 자체를 안 그려서 평소엔 기존 화면과
// 완전히 동일하다(이 기능을 한 번도 안 쓰면 UI가 한 픽셀도 안 바뀐다).
// "각 프로젝트 별로 폴더처럼 관리되어야해 — 크롬에서 사용하는걸 예시로 들어줬자나" — 낱개 탭 목록이
// 아니라 진짜 크롬 탭 그룹처럼, 어느 프로젝트(폴더)에서 연 탭인지 색+이름 라벨로 묶어서 보여준다.
// groupName/groupColor는 연 시점에 호출부가 이미 알고 있는 값(태스크 이름·색, § StatusBoard.tsx
// Card의 entry.taskName/entry.color, CalendarPane.tsx의 task.name/task.color)을 그대로 실어 보낸다 —
// 탭 스토어가 useSessionsStore를 따로 조회할 필요가 없다.
export interface GlobalBrowserTab {
	id: string
	title: string
	url: string
	// "요소 집어서 지휘자에게 전송"(§ BrowserPane.tsx handleSend)에 필요 — 전역 탭은 특정 폴더에
	// 안 묶인 경우도 있어(예: 태스크가 아직 폴더로 승격 안 됨) null일 수 있다. 그룹 접기(§ 아래
	// collapsedGroups)의 키이기도 하다.
	folderId: string | null
	// 그룹 라벨. folderId처럼 null이면(태스크가 폴더로 안 승격됨 등) 그룹 없이 낱개 탭으로 그린다.
	groupName: string | null
	groupColor: string | null
}

function genId() {
	return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `gtab-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface GlobalTabsState {
	tabs: GlobalBrowserTab[]
	// null = "메인 화면"(사이드바가 지금 보여주고 있는 것 — 캘린더든 폴더든). 전역 탭 스트립은 이걸
	// 하나의 고정 탭처럼 취급하되 별도 데이터로 안 들고 있는다 — useTabsStore의 activeNodeId가 이미
	// 그 상태를 갖고 있어 중복 저장할 이유가 없다.
	activeId: string | null
	// "메인 폴더를 누르면 축소되는 기능 — 크롬 기능을 모르나?" — 크롬 탭 그룹의 접기/펼치기. folderId
	// 기준으로 접힌 그룹을 기억한다(§ SessionShell.tsx groupGlobalTabs — 렌더 시 이 Set에 있으면 그
	// 그룹의 탭들은 안 그리고 라벨만 남긴다).
	collapsedGroups: Set<string>
	// 같은 url이 이미 열려 있으면 그 탭으로 포커스만 이동(중복 탭 방지 — § useTabsStore openOrFocusTab
	// 과 동일 원칙), 없으면 새로 연다. 둘 다 마지막에 브라우저 내비게이션 요청까지 같이 보낸다.
	openBrowserTab(title: string, url: string, folderId: string | null, groupName: string | null, groupColor: string | null): void
	closeTab(id: string): void
	setActive(id: string | null): void
	toggleGroupCollapsed(folderId: string): void
}

export const useGlobalTabsStore = create<GlobalTabsState>()((set, get) => ({
	tabs: [],
	activeId: null,
	collapsedGroups: new Set(),
	openBrowserTab: (title, url, folderId, groupName, groupColor) => {
		const existing = get().tabs.find((t) => t.url === url)
		const id = existing ? existing.id : genId()
		if (!existing) set((s) => ({ tabs: [...s.tabs, { id, title, url, folderId, groupName, groupColor }] }))
		set((s) => {
			// "확인하기"는 방금 연 걸 보고 싶다는 뜻이니, 접혀 있던 그룹으로 열리면 그 자리에서 펼친다.
			if (!folderId || !s.collapsedGroups.has(folderId)) return { activeId: id }
			const next = new Set(s.collapsedGroups)
			next.delete(folderId)
			return { activeId: id, collapsedGroups: next }
		})
		useBrowserNavStore.getState().request(id, url)
	},
	closeTab: (id) => {
		set((s) => ({
			tabs: s.tabs.filter((t) => t.id !== id),
			activeId: s.activeId === id ? null : s.activeId,
		}))
	},
	setActive: (id) => set({ activeId: id }),
	toggleGroupCollapsed: (folderId) => {
		set((s) => {
			const next = new Set(s.collapsedGroups)
			const willCollapse = !next.has(folderId)
			if (willCollapse) next.add(folderId)
			else next.delete(folderId)
			// 지금 활성 탭이 막 접히는 그룹 소속이면 더 이상 보여줄 수 없으니 메인 화면으로.
			const activeTab = s.tabs.find((t) => t.id === s.activeId)
			const activeId = willCollapse && activeTab?.folderId === folderId ? null : s.activeId
			return { collapsedGroups: next, activeId }
		})
	},
}))
