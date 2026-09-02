// OpenRM 설정 — 프론트/백엔드 공유. 현재는 리뷰어 설득 브리핑 모드 토글.
const fs = require('fs')
const path = require('path')
const FILE = process.env.OPENRM_SETTINGS_FILE || path.join(__dirname, '..', '.openrm-settings.json')
// 액션별 모델 자동 배분 — 작업 난이도↔티어(비용). 티어: Fable(설계·지휘, 최고가) > Opus(제품코드) > Sonnet(표준) > Haiku(추출·기계).
// Fable-5는 굉장히 비싸므로 '설계/고복잡도'에만. 나머지는 검증된 저비용 티어로.
const MODEL_POLICY = {
	design: 'claude-fable-5', // 설계·아키텍처 (고복잡도, 비싼 만큼 여기만)
	orchestrator: 'claude-fable-5', // 그룹 지휘/교차검증 (복잡도 최상)
	control: 'claude-fable-5', // 관제 에이전트(앱 전체: 캘린더/크론잡/설정 조작) — 지휘자와 동급 복잡도
	dev: 'claude-opus-4-8', // ▶진행 제품 코딩
	qa: 'claude-sonnet-4-6', // QA TC 생성
	verify: 'claude-sonnet-4-6', // TC 검증(playwright)
	monitor: 'claude-sonnet-4-6', // 운영/PR 모니터 루프
	debug: 'claude-sonnet-4-6', // 디버깅 요소 명령
	backlog: 'claude-sonnet-4-6', // 백로그 생성 — Notion MCP + 구조화라 haiku는 부족(안전)
	enrich: 'claude-sonnet-4-6', // 스레드 정리 — Slack/Notion MCP + 추출(안전)
	classify: 'claude-haiku-4-5', // 업무 코드/비개발 판정 — 제목·요약만 보는 경량 분류(초경량 haiku)
	ops: 'claude-sonnet-4-6', // 비개발 업무 자동수행 — Notion 쓰기+구조화+리서치(MCP), haiku 부족(안전)
	review: 'claude-opus-4-8', // PR 코드 리뷰(diff 분석·이슈 도출) — dev/improve와 동급. 검증자가 실행자(opus)보다 약하면 안 됨(하네스 원칙)
	improve: 'claude-opus-4-8', // 리뷰대로 코드 개선(제품 코드 수정·커밋·푸시)
	link: 'claude-sonnet-4-6', // 배포 백로그 연결 — Notion relation 읽고 병합(안전)
	translate: 'claude-haiku-4-5', // 브랜치명 번역(초경량 — haiku 적합)
	ppt: 'claude-sonnet-4-6', // PPT 제작 — 발표 덱 초안 생성(구조화 JSON, 품질 필요 → sonnet)
	// 태스크 기간 추정 — "탐색은 단순 모델, 판단은 무거운 모델" 2단계 분리(사용자 제안).
	// grep/read는 패턴 매칭 수준이라 haiku로 충분하고, 반복되는 탐색 턴마다 무거운 모델을 쓰는 게
	// 그동안의 시간·토큰 낭비의 핵심이었다 — 판단(추론)은 단 한 번만 무거운 모델을 태운다.
	estimateExplore: 'claude-haiku-4-5', // 1단계 — 코드 탐색(grep/read/bash), 속도 우선
	estimateJudge: 'claude-opus-4-8', // 2단계 — 조사 결과로 실제 일정 판단, review와 동급 추론력 필요
}
// operatorName — 이 인스턴스의 운영자(리뷰어) 이름. 오픈소스 배포라 특정인에 하드코딩 금지 → 설정으로 노출.
// 기본값 '운영자'는 프롬프트/피드에 그대로 넣어도 조사(가/에게)가 자연스럽게 붙는 일반 명사.
// opsMode — "하이브마인드 전체 운영 모드": 켜면 15분마다(§ control.cjs runOpsModeTick) 하이브마인드
// 자신에게 "전체 태스크 그래프 점검 → 방향/진행 확인 → 멈춘 것 지시" 프롬프트를 자동으로 넣는다.
// 기본 꺼짐 — 사람이 명시적으로 켜야 자율 지시가 나간다(레포 자동배정 사고 이후의 "검증 없는 자동
// 판단은 기본 꺼짐" 원칙과 같은 이유).
const DEFAULTS = { reviewMode: true, modelPolicy: MODEL_POLICY, fableLock: false, agentNotify: true, operatorName: '운영자', opsMode: false } // + Fable 킬스위치 + 에이전트 완료/질문 맥 알림 + 하이브마인드 운영 모드
function modelFor(action) {
	const s = load()
	const p = s.modelPolicy || {}
	let m = p[action] || MODEL_POLICY[action] || null
	// Fable 잠금 — 켜지면 fable로 배분될 작업을 opus로 스왑(비용 차단). 지휘·설계도 opus로.
	if (s.fableLock && m && /fable/.test(m)) m = 'claude-opus-4-8'
	return m
}
// 모델 id → 표시용 라벨 — 가족 이름 + 버전(예: 'claude-opus-4-8' → 'Opus 4.8'). 예전엔 가족만
// 남기고 버전을 버렸는데(그냥 'opus'), TaskRow/터미널 툴바 어디서도 몇 버전인지 알 길이 없었다.
function modelLabel(id) {
	if (!id) return ''
	const m = id.match(/^claude-(opus|sonnet|haiku|fable)-(.+)$/)
	if (!m) return id.replace(/^claude-/, '')
	const [, tier, verRaw] = m
	const version = verRaw.replace(/-/g, '.')
	return `${tier[0].toUpperCase()}${tier.slice(1)} ${version}`
}

// 액션 기준으로 표시 라벨을 계산 — fableLock 때문에 정책과 실제 배정이 달라진 경우 "(비용 잠금)"을
// 붙인다. modelLabel(id)만으로는 최종 id밖에 안 보여서 "왜 지휘자가 Fable이 아니라 Opus지?"가 안 풀림(§06).
function modelLabelFor(action) {
	const s = load()
	const p = s.modelPolicy || {}
	const wanted = p[action] || MODEL_POLICY[action] || null
	const actual = modelFor(action)
	const locked = s.fableLock && wanted && /fable/.test(wanted) && wanted !== actual
	return modelLabel(actual) + (locked ? ' (비용 잠금)' : '')
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
module.exports = { load, save, get: (k) => load()[k], operatorName, modelFor, modelLabel, modelLabelFor, MODEL_POLICY }
