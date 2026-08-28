import { create } from 'zustand'

// "링크누르면 앱내 브라우저로 이동하게해줘" — 터미널(XTerm)에서 링크를 클릭한 시점엔 그 노드의
// "브라우저" 탭(BrowserPane)이 아직 마운트조차 안 됐을 수 있다(§TabWorkspace openOrFocusTab이 지금
// 막 새로 만드는 중). 두 컴포넌트가 서로 몰라도 되게, "이 노드로 이 URL을 열어달라"는 요청만 여기
// 남겨두면 BrowserPane이 자기 노드 차례가 오면 읽어간다 — 세션 로컬, 지속 저장 안 함.
interface BrowserNavState {
	pending: { nodeId: string; url: string; nonce: number } | null
	request(nodeId: string, url: string): void
}

export const useBrowserNavStore = create<BrowserNavState>()((set, get) => ({
	pending: null,
	request: (nodeId, url) => set({ pending: { nodeId, url, nonce: (get().pending?.nonce ?? 0) + 1 } }),
}))
