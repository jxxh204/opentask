import { create } from 'zustand'

// "퀵스타트 페이지는 처음 이 앱을 켰을 때 띄워주면 어때?" — Setup 완료 후 이 컴퓨터에서 한 번도
// 안 봤으면(§openrm.quickstartSeen) 자동으로 뜬다. 별도 store로 뺀 이유는 트리거(SessionsPage) ·
// 자동 오픈 지점(SessionsPage) · 재오픈 진입점(SettingsModal)이 서로 다른 컴포넌트 트리에 있어서 —
// 지금 다른 작업이 몰려 있는 SessionShell.tsx를 안 건드리고 그 위/아래에서만 연결하기 위함.
const SEEN_KEY = 'openrm.quickstartSeen'

interface QuickstartState {
	open: boolean
	show(): void
	hide(): void
	openIfUnseen(): void
}

function hasSeen() {
	try {
		return localStorage.getItem(SEEN_KEY) === '1'
	} catch {
		return false
	}
}

function markSeen() {
	try {
		localStorage.setItem(SEEN_KEY, '1')
	} catch {
		/* private mode / no storage — fine, just won't persist */
	}
}

export const useQuickstartStore = create<QuickstartState>((set) => ({
	open: false,
	show: () => set({ open: true }),
	hide: () => {
		markSeen()
		set({ open: false })
	},
	openIfUnseen: () => {
		if (!hasSeen()) set({ open: true })
	},
}))
