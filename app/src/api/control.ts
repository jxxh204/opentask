import { api } from './client'

export interface ControlState {
	running: boolean
	session: string | null
	cwd: string
	modelLabel: string | null
}

// "관제" 에이전트 — 태스크 하나가 아니라 앱 전체(캘린더/크론잡/설정)를 대화로 조작하는 최상위
// 세션(server/control.cjs). OrchestratorPane의 conductor와 같은 패턴(Term.create + MCP 툴)이지만
// 폴더에 묶이지 않는다.
export function getControlState() {
	return api.get<ControlState>('/api/control/state')
}
export function startControl() {
	return api.post<ControlState & { ok: boolean; already?: boolean; error?: string }>('/api/control/start', {})
}
export function stopControl() {
	return api.post<{ ok: boolean }>('/api/control/stop', {})
}
// "비서에게 질문하는 버튼" — 비서가 떠 있으면 그 세션에 바로, 없으면 콜드 스타트하며 이 텍스트를
// 최초 지시에 실어 보낸다(§ server/control.cjs ask).
export function askControl(text: string) {
	return api.post<ControlState & { ok: boolean; already?: boolean; error?: string }>('/api/control/ask', { text })
}

// "대화형으로 가자" — raw 터미널 대신 claude CLI 자신의 jsonl 대화 기록을 파싱한 채팅 턴(§ ControlPane.tsx).
export type ChatPart = { kind: 'text'; text: string } | { kind: 'tool'; name: string; input: unknown; result: string | null }
export interface ChatTurn {
	id: string
	role: 'user' | 'assistant'
	ts: string
	parts: ChatPart[]
}
export function getControlTranscript() {
	return api.get<{ ok: boolean; turns: ChatTurn[] }>('/api/control/transcript')
}
