# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

소규모 개발팀. OpenTask는 원래 1인 운영자(오퍼레이터) 도구로 시작했다 — AI 리뷰/오케스트레이션 프롬프트에 "마티"라는 이름이 기본 오퍼레이터로 하드코딩되어 있던 것이 그 증거다. 오픈소스로 공개하면서 대상은 넓어졌다: 여러 명이 함께 여러 git worktree에서 동시에 도는 Claude Code 에이전트, PR, 모니터링 신호를 감시·지시하는 소규모 개발팀으로 재포지셔닝됨.

## Product Purpose

여러 git 워크트리에서 병렬로 도는 AI 코딩 에이전트를 한 화면에서 감시·지시하는 병렬 개발 관제탑. 백로그 → 워크트리 → 에이전트 → PR → 리뷰 → 모니터링까지 이어지는 루프를 GitHub/Slack/Notion/터미널 탭을 오가지 않고 한 곳에서 살아있는 상태로 조작하는 것이 목적이다. 성공은 개발자(팀)가 여러 에이전트 작업을 놓치지 않고, 실패·리뷰 요청·장애 신호에 즉시 반응해 실제 세션에 지시를 내릴 수 있는 상태다.

## Positioning

로그가 아니라 실제 제어. OpenTask는 상태를 보여주기만 하는 대시보드나 태스크 트래커가 아니라, 실제 tmux 세션·git worktree·GitHub API에 물려 있는 제어판이다. 화면에서 액션을 클릭하면 실제로 살아있는 에이전트 세션에 지시가 전달되고, PR 코멘트에 "반영"을 누르면 해당 태스크의 살아있는 터미널에 지시가 주입되며 "반박"을 누르면 실제 GitHub에 공개 답글이 게시된다. 일반 대시보드/트래커는 이 살아있는 연결을 흉내낼 수 없다.

## Operating Context

- 두 가지 실행 형태를 모두 지원: (1) 개발 모드 — Vite dev server(:5180) + Node.js 백엔드(:8770) 별도 프로세스, 기본 127.0.0.1 바인딩, LAN 개방(`OPENRM_HOST=0.0.0.0`) 시 토큰 인증 필요; (2) 패키징된 Electron 데스크톱 앱 — 동일 백엔드(`server/index.cjs`)를 in-process로 구동해 BrowserWindow가 로드, OS 표준 사용자 데이터 폴더로 상태 파일 격리, 싱글 인스턴스 락(중복 실행 시 기존 창 포커스), 외부 링크(GitHub 등 target=_blank)는 시스템 기본 브라우저로 위임. 두 형태 모두 같은 프론트/백엔드 코드를 그대로 쓰며 UI·기능 차이는 없다 — Electron은 배포 포맷일 뿐 별도 디자인 언어가 아니다.
- 대상 저장소의 `.docs/workflow/<feature>/state.json`(marty-workflow/backlog-execute 스킬 산출물)을 읽어 태스크/워크트리 상태를 구성.
- tmux + Claude Code 세션을 실제로 열고 지시를 주입 (node-pty + xterm).
- GitHub(PR/이슈/CI)를 기본으로, 필요 시 Sentry/AWS/Slack/Notion/Figma 연동을 통해 findings를 수집.
- Setup(초기 설정) 완료 전에는 Sessions/Monitor/GitHub/Architecture/Debug 페이지가 게이팅되어 접근 불가하며, 설정 전에는 데모 데이터로 동작.

## Capabilities and Constraints

- 태스크(카드)를 폴더 단위로 묶어 조직화. 각 태스크는 격리된 git worktree + 실제 tmux/Claude Code 터미널 세션으로 매핑됨.
- 오케스트레이터는 폴더의 태스크를 순차 "웨이브"로 실행(`order_idx` 기준 1개씩 활성화). 상태는 인메모리 — 서버 재시작 시 소실됨(v1 범위로 명시된 제약).
- 모니터는 단순 로그가 아닌 findings 트래커: GitHub 이슈(`involves:@me`), PR CI 실패, PR 변경 요청을 추적해 open/resolved/regression 상태를 관리하고 SSE 토스트로 알림.
- PR 리뷰 코멘트 "반영"은 태스크의 살아있는 터미널 세션에 실제 지시를 주입하고, "반박"은 실제 GitHub에 공개 답글을 게시함 — 되돌릴 수 없는 실제 액션.
- 미확정: 다중 사용자 동시 접근/권한 분리는 아직 설계되지 않음(1인 운영자 도구에서 팀 도구로 확장 중인 과도기). 기본 오퍼레이터 표시 이름 "마티"는 Setup에서 바꿀 수 있으나, 리뷰/오케스트레이션 프롬프트 다수에 하드코딩된 잔재가 남아있음(`ADAPT.md`에 문서화된 미해결 갭).

## Brand Commitments

- 라이트/다크 테마 모두 지원, 기본은 시스템 설정 추종 — 설정 모달에서 명시적으로 전환 가능.
- 한국어 우선 UI 카피.
- Pretendard(sans) + JetBrains Mono 폰트.
- 시맨틱 컬러 규칙: violet = 에이전트/선택/직렬 체인, blue = PR/링크, green = 진행/성공/병렬, amber = 대기/주의, red = 실패/삭제.
- 제품명 OpenTask(내부 코드네임 "MRM" → OpenRM을 거쳐 리브랜딩 — "무엇을 최상위 단위로 삼는가"를 기준으로 태스크 중심 정체성을 이름에 반영).

## Evidence on Hand

- 실제 코드베이스: `app/src`(React/TS 프론트엔드), `app/server`(Node.js/cjs 백엔드), `better-sqlite3` 로컬 상태 저장, `node-pty`+`xterm` 실제 터미널.
- 문서: 루트 `README.md`(모노레포 전체 설명 — agents/skills/app), `app/README.md`(앱 설명, 한국어), `ADAPT.md`(오픈소스화 시 남은 자기적응 갭 목록), `REWRITE_NEEDED.md`, `MANIFEST.md`.
- 이 저장소는 실제 사내 운영 도구에서 회사/제품 식별자를 `${PLACEHOLDER}`로 치환해 추출한 오픈소스 릴리스다. 가짜 고객·테스트모니얼·벤치마크는 없음 — 향후 작업도 이를 만들어내지 않는다. 실제 스크린샷/데모 영상은 아직 없음(현재는 코드와 문서가 유일한 근거).

## Product Principles

1. 살아있는 연결을 우선한다 — 상태 스냅샷보다, 실제 세션·저장소·API에 물린 실제 제어를 항상 우선한다.
2. 컨텍스트 스위칭 제거가 핵심 가치다 — 여러 도구(GitHub/Slack/Notion/터미널) 사이를 오가지 않고 한 화면에서 판단·조작할 수 있어야 한다.
3. 팀 규모에 맞게 확장하되 1인 운영자의 속도를 잃지 않는다 — 소규모 팀이 함께 쓰지만, 무거운 협업 오버헤드(권한 체계, 승인 플로우)를 강제하지 않는다.
4. 되돌릴 수 없는 실제 액션(GitHub 게시, 세션 지시)은 로그성 정보와 시각적으로 명확히 구분되어야 한다.
5. 설정 전에는 안전하게 게이팅한다 — 필수 설정이 끝나기 전까지 위험하거나 의미 없는 상태로 핵심 페이지에 진입시키지 않는다.

## Accessibility & Inclusion

확정된 제품 고유 요구사항 없음(별도 확인 전까지 표준 웹 접근성 준수를 기본으로 함).
