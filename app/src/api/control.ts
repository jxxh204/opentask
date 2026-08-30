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
// "중간에 대화 정지 기능도 있어야함" — 세션은 안 죽인다(위 stopControl과 다름), 지금 생성 중인
// 응답만 ESC로 끊는다(§ server/control.cjs interrupt).
export function interruptControl() {
	return api.post<{ ok: boolean; error?: string }>('/api/control/interrupt', {})
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

// "비서에서 이미지가 안 붙여넣어져. 일반 클로드세션처럼 사용할 수 있어야해" — raw 터미널(XTerm)에
// 붙여넣으면 claude CLI 자신이 클립보드 이미지를 감지해 처리하지만, 비서는 그 터미널 화면 대신
// 채팅 말풍선 UI라 일반 <textarea>는 이미지 붙여넣기를 아예 못 받는다(§ ControlPane.tsx). 서버의
// 기존 /api/dev/upload-image(원래 "요소 명령 첨부 이미지"용으로 만들어졌던 것, 지금까지 프론트
// 호출부가 없었음)를 재사용 — dataUrl을 파일로 저장하고 절대경로를 돌려주면, 그 경로를 메시지에
// 얹어 보내 비서(claude)가 Read 툴로 직접 확인하게 한다.
export function uploadImage(dataUrl: string) {
	return api.post<{ ok: boolean; path?: string; error?: string }>('/api/dev/upload-image', { dataUrl })
}
