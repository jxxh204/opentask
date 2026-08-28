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
	// "탐색은 단순 모델, 판단은 무거운 모델로" — 기존 단일 프롬프트를 2단계로 쪼갰다. 1단계(explore)는
	// 사실 수집만(판단 없음) 하는 가벼운 모델용, 2단계(judge)는 그 사실을 근거로 실제 일정을 판단하는
	// 무거운 모델용 — 반복되는 탐색 턴마다 무거운 모델을 태우던 게 그동안의 시간·토큰 낭비의 핵심이었다.
	'task.estimateDuration.explore': {
		group: '업무',
		label: '태스크 → 기간 추정 1단계(코드 조사)',
		desc: '기간 추정 파이프라인 1단계 — 코드베이스에서 관련 사실 + 실제로 열어본 파일 목록 수집(판단 없음), 가벼운 모델(estimateExplore)로 실행. 파일 목록은 서버가 디스크에서 직접 읽어 AS-IS 스니펫/에디터 링크로 리포트에 씀.',
		vars: ['title', 'desc'],
		template: [
			'너는 코드베이스 조사관이다. 아래 태스크와 관련된 사실을 이 저장소(현재 작업 디렉토리)에서 grep/read/bash로 실제로 확인해라 — 일정 판단은 하지 마라, 사실 수집만 한다. 이 결과는 그대로 다음 단계(일정 판단 담당자)에게 전달되므로 최대한 구체적으로 채워서 써라.',
			'도구 호출은 grep/read/bash 합쳐서 최대 6회까지만. 설명에 있는 외부 URL(피그마·와이어프레임 툴·노션 등)은 절대 WebFetch/브라우저로 열지 마라 — 접근 권한이 없어 항상 실패만 하고 시간을 낭비한다. 링크는 텍스트(도메인·경로)로만 참고해라.',
			'이 프로젝트는 모바일(네이티브 앱) + 웹이 함께 있는 하이브리드 구성일 수 있다 — 아래 기술 영역이 이 태스크에 해당하는지 각각 실제로 확인해서 findings에 명시해라(해당 여부에 따라 작업량이 크게 달라진다):',
			'- 웹뷰 개발: 웹뷰 안에서 동작하는 화면/로직인지, 순수 네이티브 화면인지',
			'- API 작업: 새 백엔드 엔드포인트가 필요한지, 기존 API를 그대로 재사용 가능한지',
			'- 퍼블리싱 작업: 새로 마크업·스타일링해야 할 화면/컴포넌트가 얼마나 되는지',
			'- 네이티브 브릿지 작업: JS↔네이티브 통신(권한 요청·푸시·네이티브 모듈 호출 등)이 필요한지',
			'findings에는 한국어 평문으로 500~900자 정도 정리하되, 각 항목을 실제로 확인한 파일 경로·함수명과 함께 구체적으로 채워라(판단·추정 문구는 쓰지 말고 사실만):',
			'- 관련 파일/모듈',
			'- 기존에 재사용 가능한 패턴',
			'- 웹뷰 개발 해당 여부',
			'- API 작업 해당 여부',
			'- 퍼블리싱 작업 범위',
			'- 네이티브 브릿지 작업 해당 여부',
			'- 불확실한 점(못 찾았거나 확인 못 한 것)',
			'그리고 실제로 read/grep으로 열어본 파일 중 이 태스크와 가장 관련 깊은 것을 최대 5개까지 files 배열에 적어라 — "이 저장소를 실제로 뒤졌다"는 근거로 사람이 직접 그 파일을 열어 검증할 수 있게 하기 위함이니, path는 반드시 실제로 열어본 파일의 저장소 루트 기준 상대경로여야 하고 지어내면 안 된다(모르면 files를 비워라). lines는 실제로 눈여겨본 줄 범위(예: "12-40")를 적고 모르면 빈 문자열로 둬라.',
			'설명·코드블록 없이 아래 JSON 객체 "하나만" 출력해라:',
			'{"findings":"위 형식의 평문 요약","files":[{"path":"저장소 루트 기준 상대경로","lines":"확인한 줄 범위 또는 빈 문자열","why":"이 파일이 왜 관련있는지 한 줄"}]}',
			'',
			'제목: {title}',
			'설명: {desc}',
		].join('\n'),
	},
	'task.estimateDuration.judge': {
		group: '업무',
		label: '태스크 → 기간 추정 2단계(일정 판단)',
		desc: '기간 추정 파이프라인 2단계 — 1단계 조사 결과+실제 코드(AS-IS)를 근거로 항목별(화면/로직/설계/영향범위) 예상 소요 영업일 판단 + 개발 계획 + 파일별 TO-BE 스케치 + 보강된 설명(betterDesc) 생성(Claude Code로 구현 가정, 무거운 모델 estimateJudge로 실행, 사람이 적용 여부를 정함)',
		vars: ['title', 'desc', 'findings', 'codeContext'],
		template: [
			'너는 이 팀의 일정 추정기다. 전제: 실제 구현은 사람이 처음부터 직접 타이핑하는 게 아니라 Claude Code가 코딩을 맡고, 사람(개발자)은 결과물을 리뷰하고 직접 실행해 테스트하는 역할이다.',
			'"개발 기한"과 "테스트 기한"을 분리해서 추정해라 — 뭉뚱그려 하나의 숫자로 합치면 실제로는 순식간에 끝날 구현이 사람 검증 시간 때문에 "며칠짜리 일"로 부풀려 보인다. devDays는 Claude Code가 코드를 실제로 작성하는 데 걸리는 시간이다(순수 코딩 속도라 대개 매우 짧다 — 복잡한 로직이나 여러 파일에 걸친 리팩터링이 아니면 항목당 0.1~0.5일을 넘기는 경우가 드물다, 재요청 라운드가 필요할 것 같으면 그만큼만 더해라). testDays는 개발자가 그 결과물을 직접 실행해서 눈으로 확인·시나리오별로 눌러보고 완료 확인까지 하는 시간이다(케이스·화면·기기 수가 진짜 병목 — 종종 devDays보다 testDays가 더 크다). 이 둘의 합이 캘린더에 잡히는 총 기간이 된다.',
			'아래는 별도 조사 단계에서 이 저장소를 실제로 grep/read해 이미 확인한 사실이다 — 이 내용만 근거로 판단해라(직접 다시 탐색하지 마라, 이미 다 조사했다):',
			'[조사 결과]',
			'{findings}',
			'[조사 단계가 실제로 읽은 코드(AS-IS, 지금 저장소의 실제 내용 그대로)]',
			'{codeContext}',
			'판단할 때 특히 반영해라 — 조사 결과에 웹뷰 개발이나 네이티브 브릿지 작업이 해당된다면 플랫폼 간 통신 디버깅·실기기 테스트가 추가로 필요해 로직/영향범위가 늘어날 수 있고, 새 API 작업이 필요하면 로직에, 퍼블리싱 범위가 넓으면 화면 항목에 반영해라.',
			'먼저 판정해라 — 설명과 조사 결과를 다 합쳐도 "실제로 무엇을 만들어야 하는지"를 특정할 수 없는 경우(예: 설명이 담당자 배분 메모일 뿐 기능 스펙이 아니거나, 조사에서도 대응되는 코드/화면을 못 찾아 서로 다른 여러 해석이 동등하게 가능한 경우)엔 억지로 숫자를 만들어내지 말고, 아래 형식으로만 출력하고 끝내라(breakdown 없이):',
			'{"tooVague":true,"vagueReason":"설명에 무엇이 더 필요한지 한 줄(한국어, 예: \'어떤 화면에서 어떤 동작인지 명시 필요\')"}',
			'그 정도로 막연하지 않다면(조사 결과로 하나의 그럴듯한 해석에 충분히 수렴한다면) 아래처럼 정상적으로 추정해라.',
			'아래 네 항목을 각각 독립적으로 추정해라 — 해당 없으면 devDays·testDays 둘 다 0일이 기본값이다(0을 아까워하지 마라). 정수로 반올림하지 말고 0.1일 단위 소수까지 그대로 써라(예: 0.2, 0.5, 1.3) — 반나절도 안 걸리는 항목을 "숫자니까 최소 1일"로 부풀리는 게 제일 흔한 실수다. "각 항목 최소 1일"이라는 규칙은 없다.',
			'스스로 점검해라: 만약 이 전체 변경이 토글 하나·문구 하나·플래그 하나처럼 단일 파일의 몇 줄로 끝나는 수준이면, devDays는 4항목 다 0.1~0.3 정도, testDays도 실제로 확인할 화면 1~2개 수준(0~0.3)이어야 한다(총합이 1일을 넘길 이유가 없다). 화면/모바일 양쪽을 다 만지거나, 새 API·새 테이블·여러 파일에 걸치는 등 "왜 한 번에 안 끝나는지"가 조사 결과로 분명할 때만 devDays를 키우고, 확인해야 할 케이스·화면·기기가 실제로 여러 개일 때만 testDays를 키워라.',
			'1) 화면 퍼블리싱: 새로 만들거나 손대야 할 화면/컴포넌트 개수(devDays) · 개발자가 직접 눈으로 확인해야 할 반응형·인터랙션 케이스 수(testDays)',
			'2) 로직 개발: 비즈니스 로직·상태관리·API 연동·네이티브 브릿지의 복잡도(devDays) · 개발자가 직접 시나리오별로 실행해봐야 할 테스트 케이스 수(testDays)',
			'3) 설계: 기존 구조에 자연스럽게 들어가는지, 새 추상화·스키마 변경이 필요한지(devDays) · Claude 혼자 판단하기 애매해 사람 확인 라운드가 늘어나는지(testDays)',
			'4) 영향범위: 몇 개 파일/모듈(웹·모바일 양쪽 다 손대야 하는지 포함)에 걸치는지(devDays) · 다른 기능에도 파급되는 공용 코드를 건드려 회귀 테스트 범위가 넓어지는지(testDays)',
			'조사 결과에 없거나 불확실한 부분은 그 항목의 note에 "불확실"이라고 명시하고 보수적으로(넉넉하게) 잡아라.',
			'각 항목의 note는 조사 결과에서 확인된 파일/모듈명이나 왜 그 일수인지(예: "재작업 1라운드 예상")를 6~16자 내외로 아주 짧게(문장 아님, 키워드 위주) — 이건 좁은 UI에 바로 보인다.',
			'detail은 별도로 자세히 써라(사람이 나중에 펼쳐서 읽는 리포트용, note와 달리 문장으로) — 조사 결과의 어떤 파일/모듈을 근거로 삼았는지, 항목별 판단 근거, 리스크나 불확실한 부분을 3~6문장으로.',
			'whyLong — devDays+testDays 총합이 1일을 넘긴다면 왜 그만큼 걸릴 수밖에 없는지 핵심 이유만 뽑아 30자 내외 한 문장으로 적어라(예: "웹뷰 인프라 부재로 신규 구축 필요·IAP 결제 실기기 테스트 필수") — 개발 자체가 오래 걸리는 건지 검증할 케이스가 많아서인지가 드러나게, "오래 걸리는 게 정당하다"를 사람이 한눈에 납득할 구체적 근거여야 한다(뭉뚱그린 말 금지). 총합이 1일 이하면 whyLong은 빈 문자열("")로 둬라.',
			'plan에는 실제 착수 시 따라갈 개발 순서를 5~8단계 정도의 짧은 문장 배열로 적어라(예: "1. features/pricing 폴더 신규 생성 후 queries.ts에 getPricingTiers 추가").',
			'workUnits — "개발이라는 추상적인 단어보다 설계서의 업무를 순차적으로 서브태스크로 만들면 좋겠어" 요청으로 추가된 필드. plan의 세부 단계들을 그대로 나열하지 말고, 실제로 하나씩 순서대로 작업할 수 있는 굵직한 "업무 단위"로 묶어서 2~5개를 뽑아라 — 각각 "결제 API 연동", "웹뷰 호스트 화면 구현"처럼 그 자체로 하나의 작은 완결된 작업이어야 한다(plan 한 줄 그대로 베끼기 금지, 여러 plan 단계를 하나의 업무로 묶는 게 보통이다). 이 업무 단위들은 순서대로 하나씩(체이닝) 처리되며 각자 자기 git worktree를 갖게 되니, 서로 너무 잘게 쪼개거나 서로 강하게 얽힌 걸 억지로 나누지 마라 — 개수보다 "각각 독립적으로 커밋·PR 가능한 단위인가"가 기준이다. name은 8~16자 내외, summary는 그 업무에서 구체적으로 뭘 하는지 1~2문장.',
			'changes에는 위 [AS-IS] 블록에 있는 파일들 중 실제로 바뀔 파일만(최대 5개) 골라, 그 파일의 실제 AS-IS 코드를 참고해서 대략 어떤 모양이 될지 가벼운 코드 스케치를 적어라 — 정확한 문법·타입까지 맞을 필요는 없다(실제 구현이 아니라 "이런 식으로 바뀐다"는 스케치일 뿐임을 항상 명심해라), 최대 12줄. AS-IS에 없는 새 파일이 필요하면 path에 새 경로를 적고 isNew:true로 표시해라.',
			'betterDesc에는 지금 설명(막연한 메모·링크뿐일 수 있음)을 조사 결과로 보강해서, 이 태스크의 desc 필드를 통째로 대체해도 될 만큼 "무엇을 어떻게 만드는지"가 드러나는 문장으로 3~6문장 다시 써라 — 원문의 링크·메모는 남기되 조사로 알아낸 구체적 내용(관련 화면·파일·기존 패턴)을 덧붙여라.',
			'설명·코드블록 없이 아래 JSON 객체 "하나만" 출력(항목 4개 고정, 순서 그대로):',
			'{"breakdown":[{"item":"화면","devDays":0.1단위소수,"testDays":0.1단위소수,"note":"짧은 근거"},{"item":"로직","devDays":0.1단위소수,"testDays":0.1단위소수,"note":"짧은 근거"},{"item":"설계","devDays":0.1단위소수,"testDays":0.1단위소수,"note":"짧은 근거"},{"item":"영향범위","devDays":0.1단위소수,"testDays":0.1단위소수,"note":"짧은 근거"}],"detail":"3~6문장 상세 리포트","whyLong":"총합>1일일 때만 30자 내외 핵심 이유, 아니면 \'\'","plan":["1. ...","2. ...","..."],"workUnits":[{"name":"8~16자 업무 단위 이름","summary":"1~2문장"}],"changes":[{"path":"파일 경로","isNew":false,"summary":"무엇이 바뀌는지 한 줄","toBe":"가벼운 코드 스케치(최대 12줄)"}],"betterDesc":"보강된 설명 3~6문장"}',
			'',
			'제목: {title}',
			'설명: {desc}',
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
