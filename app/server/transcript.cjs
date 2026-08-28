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

function looksLikeControlTranscript(filePath) {
	try {
		const fd = fs.openSync(filePath, 'r')
		const buf = Buffer.alloc(4096)
		const n = fs.readSync(fd, buf, 0, 4096, 0)
		fs.closeSync(fd)
		return buf.toString('utf8', 0, n).includes(SEED_MARKER)
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

// jsonl 한 줄(entry)들 → 채팅 턴 배열. 각 줄이 이미 claude 자신의 턴 경계라 그대로 1턴=1버블로
// 쓴다(여러 줄을 하나로 합치는 휴리스틱은 오히려 실제 순서·타이밍을 왜곡할 위험이 있어 안 씀).
// skipFirstUser — 첫 user 턴은 항상 controlSeed()가 주입한 역할 시드 그 자체라(사람이 친 게 아님)
// 채팅에는 안 보여준다.
function parseTranscript(filePath, { skipFirstUser = true } = {}) {
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
			if (!seenFirstUser) {
				seenFirstUser = true
				if (skipFirstUser) continue
			}
			turns.push({ id: r.uuid, role: 'user', ts: r.timestamp, parts: [{ kind: 'text', text: content }] })
			continue
		}
		if (r.type === 'assistant') {
			if (!Array.isArray(content)) continue
			const parts = []
			for (const b of content) {
				if (!b) continue
				if (b.type === 'text' && b.text && b.text.trim()) parts.push({ kind: 'text', text: b.text })
				else if (b.type === 'tool_use') parts.push({ kind: 'tool', name: b.name, input: b.input, result: resultsByToolId.get(b.id) ?? null })
				// thinking 블록은 화면에 안 보여준다 — 내부 추론이라 장황하고, 사람이 볼 대화가 아니다.
			}
			if (parts.length) turns.push({ id: r.uuid, role: 'assistant', ts: r.timestamp, parts })
		}
	}
	return turns
}

module.exports = { findControlTranscript, parseTranscript, projectDirFor }
