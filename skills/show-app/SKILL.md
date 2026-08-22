---
name: show-app
description: OpenRM 앱(app/) 작업(구현/수정/버그픽스)이 끝날 때마다 항상 실행 — 실행 중인 Electron 창을 안전하게 포그라운드로 띄워 사용자가 직접 확인할 수 있게 한다. 동명 프로세스 오작동 방지를 위해 반드시 PID 기반으로 활성화한다.
category: "process"
trigger: "auto-trigger"
allowed-tools: Bash, Read
---

# Show App After Work

## Core Principle

`app/`(OpenRM Electron 앱) 관련 작업 한 라운드가 끝나면, 채팅으로 결과만 요약하고 끝내지 말고
**항상** 실행 중인 Electron 창을 사용자가 볼 수 있게 포그라운드로 띄운다. 텍스트 요약을 신뢰하게
하지 말고 직접 확인시킨다.

## 적용 시점

- `app/src`, `app/server`, `app/electron` 등 실제 앱 코드를 수정/구현/버그픽스한 라운드가 끝날 때
- 사용자가 "확인해볼게", "띄워줘" 등으로 요청했을 때도 동일 절차 사용
- 순수 문서/스킬/메모리 작업이나 리서치에는 적용하지 않음

## ⚠️ 절대 하지 말 것: 이름으로 앱 활성화

`tell application "Electron" to activate` 처럼 **일반적인 앱 이름으로 활성화하지 말 것.**
"Electron"은 여러 무관한 dev 도구(다른 프로젝트, 다른 팀원 도구 등)가 공유하는 매우 흔한
프로세스 이름이다. 실제로 이 방식으로 완전히 다른 앱을 활성화해 무관한 사용자의 실제 화면
내용(Slack/Notion 발췌, 다른 프로젝트 브랜치명 등)이 스크린샷에 노출된 사고가 있었다. 반드시
**PID로 특정**한 뒤에만 활성화한다.

## 절차

### 1. 이 프로젝트의 dev 서버/Electron 프로세스를 cwd로 특정

```bash
ps aux | grep -i "electron\|vite\|node.*index.cjs" | grep -v grep
lsof -iTCP -sTCP:LISTEN -P 2>/dev/null | grep -E "18181|18771|5180|8770"
```

포트만으로 단정하지 말고 반드시 cwd를 확인한다 — 이 프로젝트는 `OPENRM_PORT=18771`,
Vite `18181`을 쓰고(사용자의 별도 `mrm` 프로젝트가 기본 포트 5180/8770을 쓰므로 충돌 회피용),
`mrm`이 같은 머신에서 동시에 돌고 있을 수 있다.

```bash
lsof -p <pid> -a -d cwd   # /Users/gimjaehwan/project/gongbiz/openrm/app 인지 확인
```

Electron 프로세스는 `ps eww -p <pid>` 로 env를 확인해 `ELECTRON_START_URL=http://localhost:18181`,
`OPENRM_PORT=18771` 인지 재확인한다.

### 2. GUI 프로세스 목록에서 정확히 이 PID만 매칭되는지 확인

```applescript
tell application "System Events"
  set procList to {}
  repeat with p in (every process whose background only is false)
    set end of procList to (name of p) & " -- pid:" & (unix id of p)
  end repeat
  return procList
end tell
```

"Electron"이라는 이름의 GUI 프로세스가 여러 개면, 그중 1번에서 확인한 PID와 일치하는 것만
대상으로 삼는다.

### 3. PID로 활성화 + 창이 있는지 확인

```applescript
tell application "System Events"
  set targetProc to first process whose unix id is <PID>
  set frontmost of targetProc to true
  return {name of targetProc, count of windows of targetProc, name of front window of targetProc}
end tell
```

- `name of front window`가 `"OpenRM"`인지 반드시 확인한 뒤에만 스크린샷 등 다음 단계로 진행한다.
- `count of windows`가 0이면 아래 4번(좀비 상태 복구)으로.

### 4. 창이 0개(좀비 상태)면 `open -a`로 복구

이전 종료가 불완전해 프로세스는 살아있지만 창이 닫힌 상태일 수 있다. `set frontmost`만으로는
Electron의 `app.on('activate')`가 트리거되지 않는다 — macOS의 실제 reopen 이벤트가 필요하다.
새 프로세스를 중복 실행하지 않고(싱글 인스턴스 락) 기존 프로세스에 reopen 이벤트만 보낸다:

```bash
open -a "/Users/gimjaehwan/project/gongbiz/openrm/app/node_modules/electron/dist/Electron.app"
sleep 1
# 그 다음 다시 3번의 window count 확인으로 창이 생겼는지 검증
```

### 5. (선택) 창만 스크린샷

전체 화면이 아니라 해당 창 영역만 캡처:

```bash
osascript -e '
tell application "System Events"
  set targetProc to first process whose unix id is <PID>
  set w to front window of targetProc
  set {posX, posY} to position of w
  set {sizeW, sizeH} to size of w
end tell
do shell script "screencapture -R" & posX & "," & posY & "," & sizeW & "," & sizeH & " '"'"'<경로>.png'"'"'"
'
```

## Red Flags — 즉시 멈출 것

- PID를 확인하지 않고 이름으로 활성화하려는 시도
- `count of windows`/`name of front window` 확인 없이 바로 스크린샷
- 여러 Electron dev 프로세스가 떠 있는데 어느 것이 이 프로젝트인지 cwd로 검증하지 않음
- 창이 없는데 새 `electron .` 프로세스를 또 띄우려는 시도(싱글 인스턴스 락과 충돌, 좀비만 늘어남) —
  항상 `open -a`로 기존 프로세스를 재활성화

## Related

- 사용자 피드백 메모리: `feedback_show_electron_after_work` — 이 스킬이 생기기 전 기록,
  동일 절차를 서술. 이 스킬이 실행 가능한 형태의 상위 버전.
