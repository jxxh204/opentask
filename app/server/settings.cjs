// OpenRM 설정 — 프론트/백엔드 공유. 현재는 리뷰어 설득 브리핑 모드 토글.
const fs = require('fs')
const path = require('path')
const FILE = process.env.OPENRM_SETTINGS_FILE || path.join(__dirname, '..', '.openrm-settings.json')
// 액션별 모델 자동 배분 — 작업 난이도↔티어(비용). 티어: Fable(설계·지휘, 최고가) > Opus(제품코드) > Sonnet(표준) > Haiku(추출·기계).
// Fable-5는 굉장히 비싸므로 '설계/고복잡도'에만. 나머지는 검증된 저비용 티어로.
const MODEL_POLICY = {
	design: 'claude-fable-5', // 설계·아키텍처 (고복잡도, 비싼 만큼 여기만)
	orchestrator: 'claude-fable-5', // 그룹 지휘/교차검증 (복잡도 최상)
	dev: 'claude-opus-4-8', // ▶진행 제품 코딩
	qa: 'claude-sonnet-4-6', // QA TC 생성
	verify: 'claude-sonnet-4-6', // TC 검증(playwright)
	monitor: 'claude-sonnet-4-6', // 운영/PR 모니터 루프
	debug: 'claude-sonnet-4-6', // 디버깅 요소 명령
	backlog: 'claude-sonnet-4-6', // 백로그 생성 — Notion MCP + 구조화라 haiku는 부족(안전)
	enrich: 'claude-sonnet-4-6', // 스레드 정리 — Slack/Notion MCP + 추출(안전)
	classify: 'claude-haiku-4-5', // 업무 코드/비개발 판정 — 제목·요약만 보는 경량 분류(초경량 haiku)
	ops: 'claude-sonnet-4-6', // 비개발 업무 자동수행 — Notion 쓰기+구조화+리서치(MCP), haiku 부족(안전)
	review: 'claude-sonnet-4-6', // PR 코드 리뷰(diff 분석·이슈 도출)
	improve: 'claude-opus-4-8', // 리뷰대로 코드 개선(제품 코드 수정·커밋·푸시)
	link: 'claude-sonnet-4-6', // 배포 백로그 연결 — Notion relation 읽고 병합(안전)
	translate: 'claude-haiku-4-5', // 브랜치명 번역(초경량 — haiku 적합)
	ppt: 'claude-sonnet-4-6', // PPT 제작 — 발표 덱 초안 생성(구조화 JSON, 품질 필요 → sonnet)
}
// operatorName — 이 인스턴스의 운영자(리뷰어) 이름. 오픈소스 배포라 특정인에 하드코딩 금지 → 설정으로 노출.
// 기본값 '운영자'는 프롬프트/피드에 그대로 넣어도 조사(가/에게)가 자연스럽게 붙는 일반 명사.
const DEFAULTS = { reviewMode: true, modelPolicy: MODEL_POLICY, fableLock: false, agentNotify: true, operatorName: '운영자' } // + Fable 킬스위치 + 에이전트 완료/질문 맥 알림
function modelFor(action) {
	const s = load()
	const p = s.modelPolicy || {}
	let m = p[action] || MODEL_POLICY[action] || null
	// Fable 잠금 — 켜지면 fable로 배분될 작업을 opus로 스왑(비용 차단). 지휘·설계도 opus로.
	if (s.fableLock && m && /fable/.test(m)) m = 'claude-opus-4-8'
	return m
}
// 모델 id → 짧은 표기(실시간 배지)
function modelLabel(id) {
	if (!id) return ''
	if (/opus/.test(id)) return 'opus'
	if (/sonnet/.test(id)) return 'sonnet'
	if (/haiku/.test(id)) return 'haiku'
	if (/fable/.test(id)) return 'fable'
	return id.replace(/^claude-/, '')
}

// 운영자 이름 게터 — 빈 값이면 기본값으로 안전하게 폴백(프롬프트 문법 깨짐 방지).
function operatorName() {
	const n = load().operatorName
	return (n && String(n).trim()) || DEFAULTS.operatorName
}

function load() {
	try {
		return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }
	} catch {
		return { ...DEFAULTS }
	}
}
function save(patch) {
	const next = { ...load(), ...(patch || {}) }
	try {
		fs.writeFileSync(FILE, JSON.stringify(next))
	} catch (_) {}
	return next
}
module.exports = { load, save, get: (k) => load()[k], operatorName, modelFor, modelLabel, MODEL_POLICY }
