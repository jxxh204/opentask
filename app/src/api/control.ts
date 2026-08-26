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
