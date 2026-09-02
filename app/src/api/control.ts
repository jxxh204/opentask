import { api } from './client'

export interface ControlState {
	running: boolean
	session: string | null
	cwd: string
	modelLabel: string | null
	stalled?: boolean
	// "계속 유지(백그라운드 실행 & 하나의 세션)" — tmux가 있으면 서버 재시작에도 실제로 안 죽는다
	// (§ server/control.cjs getState). tmux가 없는 맥에선 항상 false — 폴백 경로 그대로.
	persistent?: boolean
	// "하이브마인드 전체 운영 모드... 유저가 직접 확인하는것도 쉬워야하는데" — opsMode는 Settings의
	// 값을 그대로 미러(단일 진실 소스는 Settings — 토글은 api/setup.ts updateOperatorSettings로).
	// lastOpsTickAt은 채팅을 스크롤하지 않고도 "정말 돌고 있나"를 헤더에서 바로 확인하기 위한 것.
	opsMode?: boolean
	lastOpsTickAt?: number | null
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
// "세션을 초기화하는거나" — "재시작"(startControl, claude --continue)과 달리 이전 대화를 안 이어받고
// 진짜 새 대화로 시작한다(§ server/control.cjs reset). 예전 대화의 jsonl 파일은 디스크에 그대로 남음.
export function resetControl() {
	return api.post<ControlState & { ok: boolean; error?: string }>('/api/control/reset', {})
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
	// "명시도 해줘" — 운영 모드가 자동으로 넣은 점검 프롬프트 턴(§ server/transcript.cjs OPS_TICK_MARKER).
	// 사람이 친 게 아니므로 ControlPane.tsx가 일반 사용자 말풍선과 다른 배지로 그린다.
	auto?: boolean
}
export function getControlTranscript() {
	return api.get<{ ok: boolean; turns: ChatTurn[] }>('/api/control/transcript')
}

// "질문이 안왔는데?" — AskUserQuestion은 사람이 답하기 전까진 대화 기록(jsonl)에 안 나타난다(§
// server/control.cjs getLivePrompt 주석) — 대화 기록 폴링과 별개로 살아있는 pty 화면을 직접 읽어
// 지금 질문이 떠 있는지+그 구조를 돌려주는 전용 폴링.
export type LivePrompt =
	| { kind: 'question'; question: string; multiSelect: boolean; options: { label: string; checked: boolean }[] }
	| { kind: 'review'; summary: string }
// "멈추기도 동작안하고 채팅창도 꺠져" — working은 실제 pty의 "생성 중" 신호(§ server/control.cjs
// getLivePrompt 주석) — /compact 같은 로컬 명령 뒤엔 응답이 영영 안 와서 대화 기록만으로는 "생성
// 중"을 오판했다. ControlPane.tsx가 이걸 진짜 기준으로 쓴다.
export function getControlLivePrompt() {
	return api.get<{ ok: boolean; waiting: boolean; working: boolean; prompt: LivePrompt | null }>('/api/control/live-prompt')
}
// 지금 화면 기준으로 고른 옵션(혹은 next/submit/cancel)을 그대로 키 하나로 옮겨 pty에 타이핑한다.
export type LiveAction = { type: 'select' | 'toggle'; index: number } | { type: 'next' | 'submit' | 'cancel' }
export function sendControlLiveAction(action: LiveAction) {
	return api.post<{ ok: boolean; error?: string }>('/api/control/live-action', { action })
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
