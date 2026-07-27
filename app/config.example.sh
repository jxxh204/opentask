#!/usr/bin/env bash
# 설정 예시 — 의존성 0(dotenv 없음)이라 .env 파일은 자동 로드되지 않습니다.
# 이 파일을 복사해 값을 채운 뒤 `source config.sh`로 쉘에 적용하고 npm run server/dev를 실행하세요.
# 아무것도 안 해도 REPO_PATH 없이 데모 데이터로 바로 실행됩니다 — 아래는 전부 선택사항.

# ── 대상 레포 (핵심) ──────────────────────────────────────────────
# export REPO_PATH="/path/to/your/repo"        # 미설정 시 데모 모드(이 앱 자신 + demo/state.json)
# export CONTROL_STATE="/path/to/state.json"    # 특정 state.json 강제 지정

# ── 서버 ──────────────────────────────────────────────────────────
# export OPENRM_PORT=8770
# export OPENRM_HOST=127.0.0.1                     # 0.0.0.0으로 LAN 노출 시 OPENRM_TOKEN 자동 요구됨
# export OPENRM_TOKEN=""                            # 비워두면 LAN 바인딩 시 매 기동마다 랜덤 생성 후 콘솔에 출력

# ── 티켓/브랜치 컨벤션 ────────────────────────────────────────────
# export OPENRM_TICKET_PREFIX="PROJ"               # "PROJ-1234" 형태 — 자기 프로젝트 접두사로
# export OPENRM_BASE_BRANCH="origin/main"

# ── GitHub PR/이슈 감시 ───────────────────────────────────────────
# export OPENRM_PR_REPOS="owner/repo1,owner/repo2"
# export VITE_OPENRM_GH_REPO="owner/repo1"             # 프론트 PR 배지 링크용 (vite 재시작 필요)

# ── 모니터 (선택 연동) ────────────────────────────────────────────
# export SENTRY_AUTH_TOKEN=""
# export SENTRY_ORG=""
# export SENTRY_PROJECT=""
# export SLACK_SIGNING_SECRET=""                # 미설정 시 원격 Slack 웹훅은 거부됨(fail-closed)
# export OPENRM_ALERT_CHANNEL=""                   # Slack 채널 ID — claude가 이 채널을 읽어 장애 인박스 채움

# ── 배포/백로그 자동생성 (선택) ───────────────────────────────────
# export OPENRM_DEPLOY_REPO="owner/repo"
# export OPENRM_BACKLOG_DB=""                       # Notion DB ID
# export OPENRM_BACKLOG_ASSIGNEE=""
# export OPENRM_BACKLOG_SERVICE=""
# export OPENRM_BACKLOG_PLATFORM=""
