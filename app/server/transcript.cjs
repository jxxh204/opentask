// transcript.cjs — "비서라는 이름에 맞게... 대화형이면 어떨까" → "대화형으로 가자". 지금까지 비서는
// XTerm으로 claude CLI의 raw TUI 화면을 그대로 보여줬다(관제 시절 이름이 남아 "raw 터미널이 주
// 콘텐츠"였던 설계 — ControlPane.tsx 참고). 그 화면을 파싱해서 채팅으로 바꾸는 대신(ANSI 렌더링을
// 역으로 읽는 건 취약하다 — 커서 이동·부분 리렌더·스피너 애니메이션까지 다 흉내내야 함), claude CLI가
// 이미 디스크에 구조화해서 쓰고 있는 진짜 대화 기록(~/.claude/projects/<cwd>/<uuid>.jsonl — --continue가
// 쓰는 바로 그 파일)을 읽는다. 입력은 그대로 기존 pty(§control.cjs ask/start — MCP 등록·seed 주입 등
// 이미 검증된 경로)로 타이핑해 넣고, 화면만 이 파일을 파싱해서 채팅 말풍선으로 보여준다.
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')

// claude CLI의 project 디렉토리 인코딩 — cwd의 '/'와 '.'을 각각 '-'로(뭉치지 않고 문자 하나씩) 바꾼
// 이름. 실측으로 확인함(예: ".../app/.openrm/..." → "...-app--openrm-..." — '/'+'.' 두 글자가
// '--' 두 개로).
function projectDirFor(cwd) {
	return path.join(os.homedir(), '.claude', 'projects', String(cwd).replace(/[/.]/g, '-'))
}

// 이 cwd에서 실행된 claude 세션은 (내 대화 세션 포함) 전부 같은 프로젝트 디렉토리에 jsonl을 쓴다 —
// "가장 최근 수정된 파일"만으로는 다른 claude 세션(예: 지금 이 코드를 작성 중인 나 자신의 대화)을
// 잘못 집을 수 있다. 그래서 파일 내용으로 판별한다 — 비서 세션은 항상 controlSeed()의 시드 문장으로
// 시작하므로, 그 마커가 있는 파일만 후보로 삼는다(이름이 "관제"였던 옛 세션도 같은 접두사라 함께 잡힘).
const SEED_MARKER = '[역할: OpenTask'

// "비서에게 물어보고 다른 탭을 가면 초기화되는문제" — 실제로는 파일이 사라진 게 아니라 이 함수가
// 그 파일을 아예 못 찾아서 매번 turns:[]만 돌려주고 있었다. claude CLI가 최근 버전부터 진짜 첫 대화
// 턴(=시드 마커) 앞에 세션 메타데이터 줄(last-prompt/mode/permission-mode/atis-latch/bridge-session
// 등)을 여러 줄 먼저 쓰기 시작했는데, 4096바이트 고정 창은 이 마커가 실측 2만 바이트 근처에 있는
// 경우를 못 잡는다(그 창을 넘겨서 늘려봤자 다음 CLI 버전이 또 늘리면 재발). 바이트 수 가정 자체를
// 버리고 파일 전체에서 찾는다 — 격리된 전용 cwd(§ control.cjs CONTROL_CWD)라 후보 파일이 보통
// 하나뿐이라 비용도 작다.
function looksLikeControlTranscript(filePath) {
	try {
		return fs.readFileSync(filePath, 'utf8').includes(SEED_MARKER)
	} catch (_) {
		return false
	}
}

function findControlTranscript(cwd) {
	const dir = projectDirFor(cwd)
	let entries
	try {
		entries = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
	} catch (_) {
		return null
	}
	let best = null
	for (const name of entries) {
		const p = path.join(dir, name)
		if (!looksLikeControlTranscript(p)) continue
		let mtime
		try {
			mtime = fs.statSync(p).mtimeMs
		} catch (_) {
			continue
		}
		if (!best || mtime > best.mtime) best = { path: p, mtime }
	}
	return best ? best.path : null
}

// content가 문자열이면 그대로, 블록 배열이면 text 블록만 이어붙인다(tool_result의 content가 이
// 두 형태 다 가능 — 툴마다 다름).
function textFromContent(content) {
	if (typeof content === 'string') return content
	if (Array.isArray(content)) {
		return content
			.filter((b) => b && b.type === 'text' && typeof b.text === 'string')
			.map((b) => b.text)
			.join('\n')
	}
	return ''
}

// "채팅창도 꺠져" — /compact 등 로컬 슬래시 명령을 돌리면 claude CLI가 그 부산물을(재개 요약,
// "이건 사람이 아니라 로컬 명령이 만든 메시지다" 경고, 명령 자체의 XML 태그 echo, 그 stdout까지)
// 전부 `type:"user"` + 문자열 content로 jsonl에 함께 남긴다 — 실제 세션 파일을 직접 열어 확인함
// (2026-09-02): `isMeta:true`가 붙는 것도 있고(예: 크로스세션 알림, `<local-command-caveat>`) 안
// 붙는 것도 있어서(`--continue` 재개 요약, `<command-name>`/`<local-command-stdout>`) isMeta 하나로는
// 못 거른다. 이 채팅 UI는 애초에 "사람이 실제로 친 말"만 말풍선으로 보여주려는 설계라(§ 위
// skipFirstUser 주석과 같은 원칙), 이런 CLI 내부 배관은 전부 건너뛴다 — 사람이 직접 입력한 순수
// 슬래시 명령("/compact" 그 자체, 태그로 안 감싸인 plain string)만 예외로 그대로 보여준다.
const RESUME_SUMMARY_RE = /^This session is being continued from a previous conversation/
function isSyntheticUserContent(content) {
	return RESUME_SUMMARY_RE.test(content) || /^<(local-command-caveat|command-name|local-command-stdout)>/.test(content)
}
// 위 부산물 중 `<local-command-stdout>`에는 claude CLI 자신의 TUI가 그리는 raw ANSI SGR 코드
// (예: "Compacted"를 흐리게 보여주는 \x1b[2m…\x1b[22m)가 그대로 들어있다 — 걸러내지 못한 다른
// 텍스트에도 혹시 섞여 있을 경우를 대비해 어시스턴트 텍스트·tool 결과에도 공통으로 한 번 씻어낸다.
function stripAnsi(s) {
	return String(s).replace(/\x1b\[[0-9;]*m/g, '')
}

// "명시도 해줘" — 운영 모드(§ control.cjs runOpsModeTick)가 15분마다 하이브마인드 자신에게 넣는
// 점검 프롬프트는 사람이 친 게 아니다. 이 마커로 시작하는 user 턴만 auto:true로 표시해 ControlPane.tsx가
// 일반 사용자 말풍선과 다른 배지로 그린다 — control.cjs의 OPS_TICK_MARKER와 반드시 같은 문자열이어야
// 한다(모듈 의존 방향을 지키려고 상수 import 대신 문자열을 그대로 복제 — transcript.cjs는 순수 파싱
// 유틸이라 control.cjs를 require하지 않는다).
const OPS_TICK_MARKER = '[운영 모드 자동 점검]'

// jsonl 한 줄(entry)들 → 채팅 턴 배열. 각 줄이 이미 claude 자신의 턴 경계라 그대로 1턴=1버블로
// 쓴다(여러 줄을 하나로 합치는 휴리스틱은 오히려 실제 순서·타이밍을 왜곡할 위험이 있어 안 씀).
// skipFirstUser — 첫 user 턴은 항상 controlSeed()가 주입한 역할 시드 그 자체라(사람이 친 게 아님)
// 채팅에는 안 보여준다.
// "내용도 안 사라져서.. 기록만 하고 일정 이상 내용은 안 보여도 될 것 같아" — 이 파일(jsonl)은 claude
// CLI가 계속 유지 세션(§ control.cjs persistent)에 영원히 이어 쓰는 진짜 기록이라 turns를 몇 개만
// 남겨도 데이터 유실이 아니다(원본 파일은 그대로 다 남는다). 매 폴링(1~2초)마다 파일 전체를 다시
// 읽고 파싱하는데, 세션이 오래갈수록 그 전체가 계속 자라 파싱 비용도 같이 늘고, 프론트도 그만큼
// 많은 DOM을 매번 다시 그려야 했다 — 최근 것만 남긴다.
function parseTranscript(filePath, { skipFirstUser = true, maxTurns = 60 } = {}) {
	let raw
	try {
		raw = fs.readFileSync(filePath, 'utf8')
	} catch (_) {
		return []
	}
	const records = []
	for (const line of raw.split('\n')) {
		if (!line.trim()) continue
		try {
			records.push(JSON.parse(line))
		} catch (_) {
			/* 쓰는 도중 잘린 마지막 줄 등 — 조용히 무시 */
		}
	}

	// tool_use_id → 결과 텍스트. tool_result는 항상 "user" 롤의 content 배열 블록으로 뒤에 따로 온다
	// (Anthropic API 규약 — 실제로 사람이 입력한 게 아니다) — 먼저 전부 모아 tool_use 쪽에 붙여준다.
	const resultsByToolId = new Map()
	for (const r of records) {
		if (r.type !== 'user' || !Array.isArray(r.message && r.message.content)) continue
		for (const b of r.message.content) {
			if (b && b.type === 'tool_result' && b.tool_use_id) {
				resultsByToolId.set(b.tool_use_id, textFromContent(b.content).slice(0, 4000))
			}
		}
	}

	const turns = []
	let seenFirstUser = false
	for (const r of records) {
		const content = r.message && r.message.content
		if (r.type === 'user') {
			if (typeof content !== 'string') continue // 배열이면 tool_result뿐 — 이미 흡수함, 별도 버블 없음
			if (r.isMeta === true || isSyntheticUserContent(content)) continue // § 위 isSyntheticUserContent 주석
			if (!seenFirstUser) {
				seenFirstUser = true
				if (skipFirstUser) continue
			}
			const isOpsTick = content.startsWith(OPS_TICK_MARKER)
			const text = stripAnsi(isOpsTick ? content.slice(OPS_TICK_MARKER.length).trim() : content)
			turns.push({ id: r.uuid, role: 'user', ts: r.timestamp, auto: isOpsTick || undefined, parts: [{ kind: 'text', text }] })
			continue
		}
		if (r.type === 'assistant') {
			if (!Array.isArray(content)) continue
			const parts = []
			for (const b of content) {
				if (!b) continue
				if (b.type === 'text' && b.text && b.text.trim()) parts.push({ kind: 'text', text: stripAnsi(b.text) })
				else if (b.type === 'tool_use') parts.push({ kind: 'tool', name: b.name, input: b.input, result: resultsByToolId.get(b.id) != null ? stripAnsi(resultsByToolId.get(b.id)) : null })
				// thinking 블록은 화면에 안 보여준다 — 내부 추론이라 장황하고, 사람이 볼 대화가 아니다.
			}
			if (parts.length) turns.push({ id: r.uuid, role: 'assistant', ts: r.timestamp, parts })
		}
	}
	return maxTurns ? turns.slice(-maxTurns) : turns
}

module.exports = { findControlTranscript, parseTranscript, projectDirFor }
