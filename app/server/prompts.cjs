// 편집 가능한 프롬프트 레지스트리 — OpenRM의 핵심 헤드리스 프롬프트를 런타임에 오버라이드.
// template의 {토큰}을 render(key, vars)로 치환. 오버라이드는 .openrm-prompts.json(gitignored)에 저장.
// 여기 등록된 프롬프트는 실제 코드가 render()로 읽으므로 UI에서 고치면 즉시 동작이 바뀐다.
const fs = require('fs')
const path = require('path')
const FILE = process.env.OPENRM_PROMPTS_FILE || path.join(__dirname, '..', '.openrm-prompts.json')

const REGISTRY = {
	'review.pr': {
		group: '리뷰',
		label: 'PR 코드 리뷰',
		desc: '개발실 🔎리뷰 — gh pr diff로 변경분을 읽고 이슈를 JSON으로 도출',
		vars: ['slug', 'number'],
		template: [
			'GitHub PR #{number} (레포 {slug})을 코드 리뷰해줘.',
			'1) `gh pr diff {number} -R {slug}` 로 변경 diff를 가져오고, 필요하면 변경된 파일을 읽어 맥락을 파악해.',
			'2) 프론트엔드(React/Next.js/TypeScript) 관점에서 정확성·버그·엣지케이스·성능·가독성·컨벤션을 검토해. 근거 있는 것만, 추측 남발 금지.',
			'3) 설명·코드블록 없이 JSON만 출력:',
			'{"summary":"한 줄 총평","verdict":"approve|comment|request_changes","issues":[{"severity":"P1|P2|P3","file":"경로","line":숫자 또는 null,"title":"짧은 제목","detail":"무엇이 왜 문제인지","fix":"제안 수정(짧게)"}]}',
			'심각도: P1=꼭 고쳐야(버그·회귀·보안), P2=권장, P3=선택. 문제 없으면 issues는 빈 배열, verdict는 approve.',
		].join('\n'),
	},
	'review.improve': {
		group: '리뷰',
		label: 'PR 리뷰대로 개선',
		desc: '개발실 🔧개선 — 리뷰를 코드에 반영 + 커밋 + 푸시(내 PR만)',
		vars: ['number', 'review'],
		template: [
			'아래 코드 리뷰를 실제 코드에 반영해줘. 지금 작업 디렉토리는 이 PR(#{number}) 브랜치가 체크아웃된 워크트리야.',
			'[리뷰]',
			'{review}',
			'지시:',
			'1) 각 이슈를 P1 우선으로 코드에서 수정해. 제안(fix)을 참고하되 더 나은 방법이 있으면 그걸로. 확신 없는 항목은 건드리지 마.',
			'2) 기존 컨벤션·스타일 유지. 리뷰 범위 밖 리팩터링·포맷팅 대량변경 금지.',
			'3) 수정 후 `git add -A && git commit` 로 커밋(메시지는 무엇을 고쳤는지 한국어로)하고 `git push` 로 이 브랜치에 푸시해.',
			'4) 마지막에 설명 없이 JSON만 출력: {"summary":"무엇을 어떻게 고쳤는지 요약","fixed":["고친 항목"],"pushed":true 또는 false}',
		].join('\n'),
	},
	'review.apply': {
		group: '리뷰',
		label: 'PR 리뷰 확인',
		desc: '개발실 📥PR 리뷰 확인 — PR에 달린 (남의) 리뷰·라인 코멘트를 실제 코드에 반영 + 커밋 + 푸시 + 항목별 답글 게시(내 PR만)',
		vars: ['number', 'reviewText'],
		template: [
			'GitHub PR #{number}에 리뷰어(사람 또는 봇)들이 남긴 아래 리뷰·코멘트를 실제 코드에 반영해줘. 지금 작업 디렉토리는 이 PR 브랜치가 체크아웃된 워크트리야.',
			'[PR에 올라온 리뷰]',
			'{reviewText}',
			'너의 역할: 리뷰어의 요청을 코드에 "반영"하는 것. 리뷰와 논쟁하지 마라 — 반박·이견 제기는 이 작업이 아니라 별도 기능(🗣️ 리뷰 항의)이 담당한다. 여기서는 요청대로 고치는 게 기본이다.',
			'지시:',
			'1) 각 지적(특히 P1)이 요구하는 변경을 코드에서 실제로 수행해. 제안이 있으면 참고하되 더 나은 방법이 있으면 그걸로.',
			'2) 파일 삭제·특정 파일을 base 상태로 되돌리기(예: PR에 섞여든 build.json 같은 노이즈를 이 PR에서 빼라는 요청)도 요청되면 수행해. PR base 브랜치는 `gh pr view {number} --json baseRefName -q .baseRefName`로 확인하고, 특정 파일만 `git checkout origin/<base> -- <파일>`로 base 내용으로 되돌려라.',
			'3) ⚠️ 자동생성 파일(build.json 등)이 pre-commit 훅(`.husky/pre-commit`의 `yarn gen:version` + `git add build.json` 등)으로 커밋마다 다시 생성돼 되돌려도 도로 붙는 경우: 되돌린 뒤 `git commit --no-verify`로 훅을 우회해 커밋해야 실제로 빠진다(그냥 `git commit`은 훅이 재생성함). 이렇게 처리하고, 그래도 안 되면 왜 안 되는지 skipped·reply에 구체적으로 밝혀라.',
			'4) 이미 코드에 반영돼 요구가 충족된 항목만 건너뛰어(skipped).',
			'5) "오탐 같다"는 이유로 임의로 건너뛰지 마라. 확신이 없으면 요청대로 반영하는 쪽을 택해. 정말로 반영이 불가능하거나(코드베이스와 충돌·정보 부족) 사람의 결정이 꼭 필요한 항목만 skipped 배열에 "무엇을 · 왜 못했는지" 한국어로 남겨라 — 절대 summary 서술로 대체하지 말고 반드시 skipped 배열에 넣어라.',
			'6) ★ 절대 이유 없이 "코드 변경 없음"으로 끝내지 마라. 반영을 못 한 지적이 하나라도 있으면 반드시 skipped에 넣고, reply에서 리뷰어에게 "무엇을 · 왜 지금 반영이 어려운지 · 무엇이 필요한지"를 설명해야 한다(예: "pre-commit 훅이 build.json을 재생성해 일반 커밋으로는 못 뺍니다 — --no-verify로 처리했습니다/처리가 필요합니다").',
			'7) 기존 컨벤션·스타일 유지. 리뷰 범위 밖 리팩터링·대량 포맷팅 금지.',
			'8) 실제로 바꾼 게 있으면 커밋(메시지는 무엇을 왜 고쳤는지 한국어) 후 `git push`로 이 브랜치에 푸시해. 자동생성 파일 정리는 위 3)대로 `--no-verify` 사용. 바꾼 게 하나도 없으면 커밋·푸시하지 마.',
			'9) 리뷰어에게 보내는 답변(reply)을 작성해 — 이 답변이 리뷰에 대한 실제 답글로 PR에 그대로 자동 게시된다. 절대 대충 쓰지 마라 — "반영했습니다"/"확인했습니다" 한 줄로 때우면 안 된다. 리뷰어가 diff를 다시 열어보지 않아도 납득할 수 있도록, 리뷰어의 각 지적(P1/P2/…)마다 번호를 매겨 항목별로 반드시 아래 3가지를 다 담아 리뷰어를 "설득"해라: ① 무엇을 어떻게 고쳤는지 — 파일:라인 또는 함수/컴포넌트명까지 구체적으로 ② 왜 그 방식이 맞는지 근거 — 다른 방법을 검토했다면 무엇을 왜 기각했는지도 ③ 그 수정에 대해 실제로 한 검증(빌드/타입체크/테스트/수동 확인 중 진짜로 한 것만 — 안 했으면 안 했다고 밝혀라). 반영 못 한 항목도 "왜 지금 못 하는지 · 무엇이 있으면 처리 가능한지"까지 구체적으로 설명해 — 사유 없는 미반영은 절대 금지.',
			'10) GitHub에 코멘트·리뷰 답글은 네가 직접 달지 마라(`gh pr comment`·`gh api …/comments` 등 금지). reply 텍스트를 시스템이 자동으로 리뷰어에게 게시한다.',
			'11) 마지막에 설명·코드블록 없이 JSON만 출력(summary·reply는 반드시 한국어):',
			'{"summary":"무엇을 반영했고 무엇을 왜 건너뛰었는지 2~3문장 요약","reply":"리뷰어에게 보내는 답변 — 각 지적마다 번호 매겨 무엇을·왜·어떻게 검증했는지까지 구체적으로 담은 정중한 한국어 브리핑(한 줄 요약 절대 금지)","applied":["반영한 항목"],"skipped":["건너뛴 항목 — 이유"],"pushed":true 또는 false}',
		].join('\n'),
	},
	'review.question': {
		group: '리뷰',
		label: 'PR 리뷰 항의/질문',
		desc: '개발실 🗣️리뷰 항의 — 리뷰 판정에 대한 반박·질문에 근거를 다시 확인해 답변',
		vars: ['slug', 'number', 'review', 'question'],
		template: [
			'GitHub PR #{number} (레포 {slug})의 아래 코드 리뷰 결과에 대해, 리뷰 대상자가 이의를 제기했다.',
			'[리뷰 결과]',
			'{review}',
			'[이의/질문]',
			'{question}',
			'지시:',
			'1) 필요하면 `gh pr diff {number} -R {slug}` 로 실제 코드를 다시 확인해 이의가 타당한지 검증해. 무비판적으로 동의하지 마라 — 근거를 갖고 판단해.',
			'2) 리뷰가 맞았으면 왜 맞았는지, 이의가 맞았으면 무엇이 잘못 지적됐는지 설명해.',
			'3) 이의가 타당해 이슈를 수정·삭제해야 하면 issues 배열을 갱신해(해당 항목 제거 또는 detail 보정). 그대로면 원본 배열을 그대로 반환.',
			'4) 설명·코드블록 없이 JSON만 출력:',
			'{"answer":"이의에 대한 답변(한국어, 근거 포함)","verdictChanged":true 또는 false,"updatedIssues":[{"severity":"P1|P2|P3","file":"경로 또는 null","line":숫자 또는 null,"title":"제목","detail":"설명","fix":"제안"}]}',
		].join('\n'),
	},
	'review.question.external': {
		group: '리뷰',
		label: 'PR 리뷰 항의/질문 (GitHub 실제 리뷰)',
		desc: '모니터 보드 🗣️ 항의 — GitHub에 실제로 달린 리뷰(변경요청 등)에 대한 반박/질문에 근거를 재확인해 답변',
		vars: ['slug', 'number', 'reviewText', 'question'],
		template: [
			'GitHub PR #{number} (레포 {slug})에 실제로 달린 아래 리뷰(사람 또는 다른 봇이 남김)에, 리뷰 대상자가 이의를 제기했다.',
			'[GitHub 리뷰 원문]',
			'{reviewText}',
			'[이의/질문]',
			'{question}',
			'지시:',
			'1) `gh pr diff {number} -R {slug}` 로 실제 코드를 다시 확인해 이의가 타당한지 검증해. 무비판적으로 동의하지 마라 — 근거를 갖고 판단해.',
			'2) 이 답변은 GitHub에 게시되지 않고 내부 대시보드에만 표시된다. 사람이 참고해 실제 리뷰어와 어떻게 소통할지 직접 판단한다.',
			'3) 설명·코드블록 없이 JSON만 출력:',
			'{"answer":"이의에 대한 답변(한국어, 근거 포함)","agreesWithObjection":true 또는 false}',
		].join('\n'),
	},
	'task.classify': {
		group: '업무',
		label: '업무 dev/ops 판정',
		desc: '업무 등록 시 코드작업(dev)/비개발(ops) 자동 분류',
		vars: ['title', 'summary', 'linkKinds'],
		template: [
			'너는 개발팀 업무 분류기다. 아래 업무가 "코드 변경이 필요한 개발 작업"인지 "코드 변경이 아닌 작업"인지 판정해라.',
			'- dev = 제품/서버/앱의 소스코드를 수정·추가·삭제해야 끝나는 일 (버그수정, 기능개발, 리팩터링, 마이그레이션, API 연동 등)',
			'- ops = 코드를 건드리지 않는 일 (노션/문서 정리·작성, 회의·워크숍 준비, 일정·인원 조율, 리서치·조사, 정책/기획 검토 등)',
			'- 근거가 부족해 확신이 낮으면 unsure.',
			'설명·코드블록 없이 아래 JSON 객체 "하나만" 출력:',
			'{"class":"dev|ops|unsure","confidence":0~1 사이 숫자,"reason":"판정 근거 한 줄(한국어)","plan":"ops면 워크트리·PR 없이 어떻게 처리하면 되는지 한 줄, 아니면 빈 문자열"}',
			'',
			'제목: {title}',
			'요약: {summary}',
			'첨부 링크 종류: {linkKinds}',
		].join('\n'),
	},
	'task.repoClassify': {
		group: '업무',
		label: '태스크 → 레포 자동배정',
		desc: '개발실 — 멀티레포 프로젝트에서 새 태스크가 어느 레포 작업인지 제목·설명 기반으로 자동 판정',
		vars: ['title', 'desc', 'repoList'],
		template: [
			'너는 개발팀의 레포 라우팅 판정기다. 아래 태스크가 등록된 레포들 중 어디서 작업해야 하는지 골라라.',
			'각 레포의 설명(이 레포가 담당하는 영역)을 근거로, 태스크 제목·설명과 가장 잘 맞는 레포 1개를 선택해라.',
			'애매하면(설명만으론 판단 불가) 가장 근거가 강한 것 하나를 고르되 confidence를 낮게 줘라.',
			'설명·코드블록 없이 아래 JSON 객체 "하나만" 출력:',
			'{"repoId":"선택한 레포의 id","confidence":0~1 사이 숫자,"reason":"판정 근거 한 줄(한국어)"}',
			'',
			'태스크 제목: {title}',
			'태스크 설명: {desc}',
			'등록된 레포 목록:',
			'{repoList}',
		].join('\n'),
	},
	'task.ops': {
		group: '업무',
		label: '비개발 업무 자동수행',
		desc: 'ops로 판정된 업무를 워크트리 없이 MCP로 처리(노션 정리·문서·리서치)',
		vars: ['title', 'summary', 'planLine', 'linksBlock'],
		template: [
			'너는 개발팀의 "비개발 업무 수행" 에이전트다. 아래 업무는 코드 변경이 아니라 노션 정리·문서 작성·리서치·조율 같은 작업이다.',
			'워크트리/PR/코드수정은 절대 하지 마. 대신 MCP 도구(Notion/Slack/웹검색)로 실제 결과물을 만들어라.',
			'절차:',
			'1) 첨부 링크(슬랙 스레드·노션·피그마)와 제목·요약을 읽고 "구체적으로 무엇을 만들어야 하는지" 파악한다.',
			'2) 그 결과물을 실제로 수행한다 — 예: 노션 페이지/DB 생성·정리·속성 추가, 문서 초안 작성, 자료 조사 요약.',
			'3) 안전규칙: 추가/보완 위주. 기존 내용 삭제·대량 변경 금지. 사람의 결정이 필요한 지점(선택지·승인)은 실행하지 말고 보고만 한다.',
			'4) 다 하면 설명·코드블록 없이 아래 JSON "하나만" 출력한다:',
			'{"summary":"실제로 한 일 2~3줄(한국어)","artifacts":["생성/수정한 노션 등 URL",...],"needsHuman":true 또는 false,"ask":"사람 결정이 필요하면 질문 한 줄, 없으면 빈 문자열"}',
			'',
			'제목: {title}',
			'요약: {summary}',
			'{planLine}',
			'{linksBlock}',
		].join('\n'),
	},
	'monitor.dispatch': {
		group: '모니터',
		label: '알림 → 조사 지시',
		desc: '모니터 알림 → 액션 — 감지된 이슈(Sentry·Vitals 등)를 코드베이스에서 조사시켜 원인·제안을 JSON으로 회수 (실제 코드 수정은 하지 않음)',
		vars: ['kind', 'title', 'repo', 'detail', 'url', 'instruction'],
		template: [
			'OpenRM 모니터가 아래 이슈를 감지했다.',
			'[이슈] 종류:{kind} · 레포:{repo} · 제목:{title}',
			'{detail}',
			'{url}',
			'[사람의 지시]',
			'{instruction}',
			'지시:',
			'1) 이 저장소(현재 작업 디렉토리)에서 관련 코드를 grep/read로 실제 확인해 원인을 조사해라. 추측 남발 금지 — 근거를 찾은 만큼만 말해.',
			'2) 코드를 실제로 고치지는 마라 — 이 작업은 조사·제안까지다. 무엇을 어떻게 고치면 되는지 파일:라인 수준으로 구체적으로 제안해라.',
			'3) 설명·코드블록 없이 JSON만 출력: {"summary":"원인 및 결론 2~3문장(한국어)","rootCause":"파악된 원인 또는 \'불확실\'","suggestion":"구체적 수정 제안 또는 다음 조사 단계","confidence":"high|medium|low"}',
		].join('\n'),
	},
	'monitor.alerts': {
		group: '모니터',
		label: '장애 채널 읽기',
		desc: '🔔모니터 장애 인박스 — Slack 장애채널을 읽어 이슈 단위 JSON으로 정리',
		vars: ['channelId'],
		template: [
			'Slack 채널(channel_id {channelId})의 최근 메시지 ~30개를 Slack MCP(slack_read_channel, response_format=detailed)로 읽어줘.',
			'운영 장애/오류 알림(server-monitor 4xx/5xx, Sentry, 네이티브 브릿지/trackEvent 실패 등)을 "이슈 단위"로 묶어 정리해. 사람 잡담·일일 요약은 제외.',
			'같은 이슈가 여러 번 발생하면 하나로 합치고, 안정적 고유키 id를 정해: Sentry는 Short ID(예: "CRM-FRONT-CLIENT-14T" → id "14T"), server-monitor는 증상 핵심 키워드(예: "web-4xx-spike"). ⚠️ 메시지 ts는 매번 바뀌니 절대 id로 쓰지 마.',
			'resolved 판정은 엄격히 — 스레드에 "배포 완료 / 수정됨 / mute 처리함 / 정상화" 같은 명시적 해결이 있을 때만 true. ⚠️ 단순 트리아지 댓글·"확인 중"·"사용자 영향 없음"·"모니터링 중"은 resolved 아님(false). 지금도 반복 발생 중이면 무조건 false.',
			'각 이슈 필드: id, 한 줄 제목(title), 최근 발생 HH:MM(ts), 발생 횟수(count: 반복 몇 회인지 스레드에서 파악되면 그 숫자, 모르면 1), 스레드 permalink(threadUrl, slack_get_permalink 우선), resolved(위 기준).',
			'그리고 스레드를 아래 구조로 요약(가독성용, 각 항목 짧게 한국어):',
			'  · symptom: 무엇이 어떻게 실패하는지 1줄 (예 "웹뷰에서 trackEvent Android 브릿지 호출 실패")',
			'  · impact: 영향 규모만 짧게 (건수·사용자수 등, 예 "221건·16명" 또는 "기능 정상, 로깅만 누락", 모르면 "미상")',
			'  · source: 레포/영역 태그 1개 (예 "crm-front-client", "server-monitor", "webview")',
			'  · status: 현재 상태 1단어~짧게 (예 "Ongoing", "배포 대기", "모니터링 중", "원인 파악 중")',
			'  · summary: 위를 합친 1문장 폴백 요약 (반복이면 "N회 반복" 포함)',
			'설명·코드블록 없이 JSON 배열만: [{"id":"14T","title":"웹뷰 trackEvent 브릿지 실패","ts":"09:05","count":23,"threadUrl":"https://...","resolved":false,"symptom":"웹뷰에서 trackEvent Android 브릿지 호출 실패","impact":"25건, 기능은 정상·로깅만 누락","source":"crm-front-client","status":"Sentry mute 제안","summary":"..."}]',
		].join('\n'),
	},
}

function loadOverrides() {
	try {
		return JSON.parse(fs.readFileSync(FILE, 'utf8'))
	} catch {
		return {}
	}
}
function saveOverrides(o) {
	try {
		fs.writeFileSync(FILE, JSON.stringify(o, null, 2))
	} catch (_) {}
}
function templateFor(key) {
	const o = loadOverrides()
	if (o[key] != null) return o[key]
	return (REGISTRY[key] && REGISTRY[key].template) || ''
}
// {토큰} 치환 — 등록 안 된 키/빈 템플릿은 빈 문자열
function render(key, vars) {
	let t = templateFor(key)
	if (!t) return ''
	for (const [k, v] of Object.entries(vars || {})) t = t.split('{' + k + '}').join(v == null ? '' : String(v))
	return t
}
function list() {
	const o = loadOverrides()
	return Object.entries(REGISTRY).map(([key, def]) => ({
		key,
		group: def.group,
		label: def.label,
		desc: def.desc,
		vars: def.vars || [],
		default: def.template,
		current: o[key] != null ? o[key] : def.template,
		overridden: o[key] != null,
	}))
}
function setOverride({ key, template }) {
	if (!REGISTRY[key]) return { ok: false, error: '등록되지 않은 프롬프트 키' }
	const o = loadOverrides()
	if (template == null || String(template) === REGISTRY[key].template) delete o[key] // 기본과 동일하면 오버라이드 제거
	else o[key] = String(template)
	saveOverrides(o)
	return { ok: true, overridden: o[key] != null }
}
function reset({ key }) {
	const o = loadOverrides()
	delete o[key]
	saveOverrides(o)
	return { ok: true }
}
module.exports = { render, list, setOverride, reset, templateFor, REGISTRY }
