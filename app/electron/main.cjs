#!/usr/bin/env node
// electron/main.cjs — OpenRM 데스크톱 셸.
// server/index.cjs(HTTP+WS, 무변경)를 detached 자식 프로세스로 따로 띄우고 BrowserWindow가
// http://127.0.0.1:<port>를 로드한다 (file:// 아님 — BrowserRouter/상대경로 fetch 무변경 유지).
// "앱을 끄더라도 클로드 세션이 계속 일하고 있었으면 좋겠다" — 백엔드를 이 프로세스 안에서 in-process로
// 구동하면 앱 종료(Cmd+Q)에 지휘자·서브태스크 세션까지 전부 같이 죽는다. 그래서 detached 자식으로
// 분리해 Electron이 죽어도 백엔드+세션은 산다(§ resolveDetachedBackendUrl). dev 모드에선
// ELECTRON_START_URL(Vite dev server)을 그대로 로드 — 백엔드는 `yarn dev`/`yarn electron:dev`가 이미
// 별도 프로세스로 띄운다(HMR 유지, 기존 dev 워크플로 무변경 — 이 파일은 그 경로를 안 건드린다).
'use strict'

const { app, BrowserWindow, shell, Menu, dialog, ipcMain, nativeImage, Notification } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const net = require('net')
const { execFileSync, spawn } = require('child_process')
const { autoUpdater } = require('electron-updater')

const APP_ICON_PATH = path.join(__dirname, '..', 'build', 'icon.png')

// 패키징 시엔 electron-builder(build.icon)가 앱 번들 아이콘을 심어주지만, `electron .`으로 띄우는
// 개발 모드는 그 과정을 안 거치므로 Dock 아이콘이 기본 Electron 로고로 나온다 — 여기서 직접 세팅.
app.setName('OpenTask')

// ── PATH 상속 보정 ──────────────────────────────────────────────────────
// macOS에서 Dock/Finder로 띄운 GUI 앱은 로그인 셸의 PATH(.zshrc/.zprofile 등에서 추가된
// nvm/brew/asdf 경로)를 상속받지 못한다. git/gh/tmux/aws/claude CLI 호출이 전부 여기 의존하므로
// 부팅 즉시 로그인 셸에서 PATH를 캡처해 병합한다. 실패해도 비치명적(경고만 남기고 계속).
function fixPath() {
  if (process.platform === 'win32') return
  try {
    const shellBin = process.env.SHELL || '/bin/zsh'
    const captured = execFileSync(shellBin, ['-ilc', 'echo -n "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim()
    if (!captured) return
    const merged = Array.from(new Set([...captured.split(':'), ...(process.env.PATH || '').split(':')])).filter(Boolean)
    process.env.PATH = merged.join(':')
  } catch (e) {
    console.warn('⚠️  PATH 보정 실패 — 로그인 셸에서 PATH를 캡처하지 못함:', (e && e.message) || e)
  }
}
fixPath()

// ── 싱글 인스턴스 락 ─────────────────────────────────────────────────────
// tmux 세션명은 orm- 접두만 있을 뿐 머신 전역이고, SQLite(WAL)/flat-JSON도 멀티 라이터 안전하지
// 않다. 두 번째 실행은 새 서버를 띄우는 대신 기존 창을 포커스한다.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  let mainWindow = null

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // ── 데이터 디렉토리 재배치 ───────────────────────────────────────────
  // server/*.cjs 쪽 코드는 무변경 — 이미 개별 env var로 독립 오버라이드 가능하므로,
  // require 전에 OS 표준 사용자 데이터 폴더로 세팅만 해준다(앱 번들 안에 상태가 쌓이지 않게).
  const FILE_ENV_DEFAULTS = {
    OPENRM_DEPLOYS_FILE: '.openrm-deploys.json',
    OPENRM_SESSIONS_FILE: '.openrm-sessions.json',
    OPENRM_ALERTS_FILE: '.openrm-alerts.json',
    OPENRM_PROMPTS_FILE: '.openrm-prompts.json',
    OPENRM_SETTINGS_FILE: '.openrm-settings.json',
    OPENRM_TASKS_FILE: '.openrm-tasks.json',
    OPENRM_JOBFAILS_FILE: '.openrm-jobfails.json',
    OPENRM_NOTION_TITLES: '.openrm-notion-titles.json',
    OPENRM_ORCH_FILE: '.openrm-orch.json',
  }
  function setDataEnv() {
    const dataDir = path.join(app.getPath('userData'), 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    process.env.OPENRM_DATA_DIR = process.env.OPENRM_DATA_DIR || dataDir
    for (const [key, filename] of Object.entries(FILE_ENV_DEFAULTS)) {
      if (!process.env[key]) process.env[key] = path.join(dataDir, filename)
    }
  }

  // 개발 중엔 `yarn dev`/`yarn start`가 Vite(:5180)+백엔드(:8770)를 이미 띄워두고 이 URL로 전달한다.
  // Vite가 아직 뜨는 중일 수 있으니 로드 실패 시 짧게 재시도.
  async function loadWithRetry(win, url, attemptsLeft = 20) {
    try {
      await win.loadURL(url)
    } catch (e) {
      if (attemptsLeft <= 0) throw e
      await new Promise((r) => setTimeout(r, 300))
      return loadWithRetry(win, url, attemptsLeft - 1)
    }
  }

  // "클로드 세션이 백엔드에서 돌아서 내가 앱을 끄더라도 계속 업무를 하고있었으면 좋겠는데" — 예전엔
  // 백엔드를 이 Electron 프로세스 안에서 in-process로 구동해서, 앱을 완전히 종료(Cmd+Q)하면 지휘자·
  // 서브태스크·관제 세션까지 전부 같이 죽었다(전부 이 프로세스의 자식 pty였으므로). 지금은 dev
  // 모드(`yarn electron:dev`)가 이미 이렇게 동작한다 — Vite+백엔드가 Electron과 완전히 분리된
  // 프로세스라 창을 닫아도(심지어 Cmd+Q로 완전 종료해도) 백엔드는 안 죽는다. 프로덕션도 같은 모양으로
  // 맞춘다: 백엔드를 in-process로 요구하는 대신 detached 자식 프로세스로 따로 띄우고, 이 Electron
  // 프로세스가 죽어도(quit) 그 자식은 살아남는다. 다음 실행 때는 PID 파일로 "이미 떠 있나" 확인해서
  // 중복 스폰을 막는다(§ resolveDetachedBackendUrl).
  const BACKEND_PIDFILE_NAME = 'backend.json'

  function pidIsAlive(pid) {
    try {
      process.kill(pid, 0) // 시그널 0 — 실제로 죽이지 않고 존재 여부만 확인
      return true
    } catch (_) {
      return false
    }
  }

  // 그냥 "포트에 뭔가 응답한다"만 보고 healthy로 치면, 그 포트를 다른 프로세스(예: 다른 프로젝트의
  // 개발 서버)가 먼저 차지하고 있을 때도 통과해버려 엉뚱한 응답을 그대로 렌더링하게 된다(검은 화면
  // 사고로 실제 재현됨). /api/health의 JSON 바디에 ok:true가 있는지까지 확인해야 "우리 서버가 맞다"고
  // 판단한다 — 완벽한 구분은 아니지만(형제 프로젝트도 같은 엔드포인트 모양일 수 있음) 최소한 전혀
  // 무관한 서비스가 그 포트를 잡고 있는 경우는 걸러낸다.
  function pingHttp(url, timeoutMs = 1500) {
    return new Promise((resolve) => {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            resolve(body && body.ok === true)
          } catch {
            resolve(false)
          }
        })
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
    })
  }

  // node_modules 전체가 asar.unpacked로 풀리면서(§ asarUnpack) require() 콜드스타트가 파일시스템
  // 스탯 콜 다발로 느려졌다 — 예전 12초(40×300ms) 예산으로는 백엔드가 실제로는 정상 기동됐는데도
  // 타임아웃으로 먼저 포기해버려 검은 화면만 남는 사고가 있었다(§ backend.log엔 정상 시작 로그가
  // 있는데 메인 프로세스는 이미 실패로 단정한 상태). 45초로 늘렸는데도 클린 상태 재현 테스트에서 또
  // 타임아웃이 났다 — 다운로드 직후 첫 실행은 macOS Gatekeeper가 격리 속성(com.apple.quarantine)이
  // 붙은 앱 번들 안 파일을 전부(asarUnpack이 node_modules 전체라 수만 개) 훑고 나서야 실행을 허용해서
  // 콜드스타트가 더 오래 걸릴 수 있다. 120초로 더 늘리고, 그동안 사용자가 "멈췄나?" 오해하지 않도록
  // createWindow()가 로딩 화면을 먼저 띄운다(§ LOADING_DATA_URL).
  async function waitForHealthy(url, { attempts = 240, intervalMs = 500 } = {}) {
    for (let i = 0; i < attempts; i++) {
      if (await pingHttp(url)) return true
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    return false
  }

  // 실제 연결을 시도해 그 포트에 뭔가 떠 있는지만 확인한다(HTTP 응답 내용은 안 봄 — 그냥 "선점됐나"
  // 빠르게 판단하는 용도). ECONNREFUSED면 비어있는 포트.
  function isPortTaken(port, host, timeoutMs = 300) {
    return new Promise((resolve) => {
      const socket = net.connect({ port, host, timeout: timeoutMs })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('timeout', () => {
        socket.destroy()
        resolve(false)
      })
      socket.once('error', () => resolve(false))
    })
  }

  async function resolveDetachedBackendUrl() {
    setDataEnv()
    const host = '127.0.0.1'
    const pidFile = path.join(app.getPath('userData'), BACKEND_PIDFILE_NAME)

    // 기본값 8770 대신 18771 — 이 개발자 머신엔 이 레포와 무관한 다른 프로젝트(mrm)가 자기 서버를
    // 기본 포트 8770/5180으로 띄운다(그쪽도 같은 계열 코드베이스라 API 응답 형태까지 비슷해서 내용으로
    // 구분하기도 애매하다). 그 상태에서 이 앱을 켜면 "8770에 뭔가 응답한다"만 보고 자기 백엔드가 뜬
    // 줄 착각해 mrm의 엉뚱한 응답을 그대로 로드해 검은 화면만 뜨는 사고가 실제로 있었다. dev 모드가
    // 이미 이 충돌을 피하려고 OPENRM_PORT=18771을 쓰고 있어(§ skills/show-app/SKILL.md) 패키징 앱
    // 기본값도 맞춘다. 그래도 다른 무언가가 18771까지 잡고 있을 수 있으니, 사용자가 OPENRM_PORT를
    // 명시하지 않은 한(=우리가 자유롭게 고를 수 있는 상황) 비어있는 포트를 찾을 때까지 순차로 미리
    // 시도한다(스폰→EADDRINUSE 크래시를 기다리는 대신 connect로 먼저 가볍게 확인).
    const explicitPort = process.env.OPENRM_PORT ? Number(process.env.OPENRM_PORT) : null
    const basePort = explicitPort || 18771
    let port = basePort
    if (!explicitPort) {
      for (let i = 0; i < 10; i++) {
        const candidate = basePort + i
        if (!(await isPortTaken(candidate, host))) {
          port = candidate
          break
        }
        console.warn(`⚠️  포트 ${candidate}가 이미 사용 중 — 다음 포트 시도`)
        port = null // 10개 다 막혀 있으면 아래에서 basePort로 폴백해 기존 에러 메시지를 그대로 낸다
      }
      if (port === null) port = basePort
    }
    const url = `http://${host}:${port}/`
    // pingHttp는 JSON 바디의 ok:true를 확인하는데(§ pingHttp), "/"는 SPA index.html(순수 HTML)을
    // 돌려주는 프론트엔드 라우트라 JSON.parse가 항상 실패해 "응답 없음"으로 오판했다 — 백엔드가 몇 초
    // 만에 정상 기동돼도 헬스체크는 매번 타임아웃 전체를 다 채우고서야 실패로 끝났다(검은 화면/로딩
    // 화면이 안 넘어가던 진짜 원인). 헬스체크는 반드시 JSON을 내려주는 /api/health로 해야 한다.
    const healthUrl = `${url}api/health`

    // 이미 떠 있는 백엔드가 있으면(이전 실행에서 종료 없이 남아있던 것) 그대로 재사용 — PID 생존 +
    // 실제로 그 포트가 응답하는지 이중 확인(PID 재사용 오탐 방지). 포트를 자동으로 고르는 경로라
    // pidFile에 저장된 포트를 기준으로 확인해야 한다.
    try {
      const saved = JSON.parse(fs.readFileSync(pidFile, 'utf8'))
      const savedUrl = `http://${host}:${saved.port}/`
      if (saved && saved.pid && pidIsAlive(saved.pid) && (await pingHttp(`${savedUrl}api/health`))) {
        console.log(`♻️  기존 백엔드 재사용 (pid ${saved.pid}) — ${savedUrl}`)
        return savedUrl
      }
    } catch (_) {
      // 파일 없음/파싱 실패 — 새로 띄운다
    }

    // asar 안의 경로를 그대로 spawn하면 OS가 그 파일을 못 연다(asar는 Electron이 patch한 fs/require
    // 레벨에서만 이해하는 가상 아카이브 — 일반 OS 프로세스 실행엔 실제 경로가 필요). server/**는
    // electron-builder 설정(asarUnpack)에서 이미 풀어두므로 패키징 시엔 .asar.unpacked로 치환한다.
    let serverEntry = path.join(__dirname, '..', 'server', 'index.cjs')
    if (app.isPackaged) serverEntry = serverEntry.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    const logPath = path.join(app.getPath('userData'), 'backend.log')
    const logFd = fs.openSync(logPath, 'a')
    const child = spawn(process.execPath, [serverEntry], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      // path.join(__dirname, '..')로 그냥 계산하면 패키징 시 app.asar "안" 경로가 된다 — app.asar는
      // Electron이 패치한 fs 레벨에서만 폴더처럼 보이는 가상 아카이브고, 실제로는 파일 하나다. OS
      // spawn()의 cwd로 그 경로를 넘기면 "디렉토리가 아님"으로 즉시 실패한다(spawn ENOTDIR) — 검은
      // 화면의 진짜 원인이 이거였다(서명·공증과 무관하게 패키징 빌드 100%에서 재현됨). serverEntry는
      // 이미 asar.unpacked로 치환된 실제 경로이므로, 거기서 cwd를 유도해 같은 실수를 반복하지 않는다.
      cwd: path.join(serverEntry, '..', '..'),
      // ELECTRON_RUN_AS_NODE — 패키징된 앱엔 별도 node 바이너리가 없다(Electron 바이너리 자체를
      // Node 런타임으로 쓰는 표준 우회). 이 값이 있으면 Electron이 GUI 없이 순수 Node 스크립트처럼
      // server/index.cjs를 실행한다(그 파일의 require.main===module 자동 기동 그대로 탄다).
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OPENRM_PORT: String(port) },
    })
    fs.closeSync(logFd) // 자식이 이미 이어받았다 — 이 프로세스(오래 사는 GUI 앱)에서 fd 누수 방지
    fs.writeFileSync(pidFile, JSON.stringify({ pid: child.pid, port, startedAt: Date.now() }))
    child.unref() // 이 Electron 프로세스가 죽어도(quit) 저 자식은 살아남는다 — 오늘 요청의 핵심.

    const healthy = await waitForHealthy(healthUrl)
    if (!healthy) throw new Error(`백엔드가 응답하지 않습니다(포트: ${port}, 로그: ${logPath})`)
    console.log(`🚀  백엔드 새로 기동 (pid ${child.pid}) — ${url}`)
    return url
  }

  async function resolveTargetUrl() {
    const devUrl = process.env.ELECTRON_START_URL
    if (devUrl) return devUrl
    return await resolveDetachedBackendUrl()
  }

  // resolveTargetUrl()이 창에 로드하는 URL과, 백엔드 API 베이스 URL은 프로덕션에선 같지만(같은
  // 서버가 정적 프론트+API 둘 다 서빙) dev 모드에선 다르다 — ELECTRON_START_URL은 Vite(:5180)고,
  // 백엔드는 vite.config.ts와 똑같은 규칙(OPENRM_PORT || 8770)으로 별도 포트에 떠 있다.
  function backendApiBaseFor(loadedUrl) {
    if (process.env.ELECTRON_START_URL) return `http://localhost:${process.env.OPENRM_PORT || 8770}/`
    return loadedUrl
  }

  // ── 알림 클릭 브리지(§ server/notify.cjs) ────────────────────────────────
  // "푸시알림 누르면 접속이 안됨" — server/notify.cjs가 쓰던 osascript display notification은 클릭
  // 액션이 없다. 여기서 대신 heartbeat(내가 살아있다고 알림)+pending(띄울 알림 큐) 두 엔드포인트를
  // 5초마다 폴링해서, 클릭하면 창을 포커스하는 진짜 Electron Notification으로 띄운다. 창이 닫혀 있어도
  // (mac은 Dock에 남아 이 프로세스가 계속 살아있음) 계속 폴링 — 특정 창에 종속시키지 않는다.
  let notifyPollStarted = false
  function startNotifyPolling(apiBase) {
    if (notifyPollStarted) return
    notifyPollStarted = true
    const timer = setInterval(async () => {
      try {
        await fetch(`${apiBase}api/notify/heartbeat`, { method: 'POST' })
        const r = await fetch(`${apiBase}api/notify/pending`)
        const body = await r.json()
        if (!body || !body.ok || !Array.isArray(body.items)) return
        for (const item of body.items) {
          if (!Notification.isSupported()) continue
          const n = new Notification({ title: item.title, body: item.body || '' })
          n.on('click', () => {
            if (!mainWindow) return
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.show()
            mainWindow.focus()
          })
          n.show()
        }
      } catch (_) {
        // 백엔드가 잠깐 안 뜨는 중이거나 응답 실패 — 다음 폴링에서 다시 시도, 여기선 조용히 무시.
      }
    }, 5000)
    app.on('before-quit', () => clearInterval(timer))
  }

  // 창을 만들자마자(backgroundColor '#0b0d10'가 사실상 검정이라) 백엔드 헬스체크가 끝날 때까지
  // 아무 것도 안 그려주면, 정상 진행 중이어도 "꺼진 검은 화면"과 구분이 안 된다 — 최소한 로딩 중임을
  // 보여준다. 실패 시엔 아래 showStartupFailure()가 실제 원인을 사용자에게 보여준다.
  const LOADING_DATA_URL =
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0b0d10;color:#9aa4af;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px}
.spinner{width:28px;height:28px;border:3px solid #262b31;border-top-color:#5b8cff;border-radius:50%;animation:spin 0.8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
p{font-size:13px;letter-spacing:.02em}
</style></head><body><div class="spinner"></div><p>OpenTask 백엔드를 시작하는 중입니다… / Starting OpenTask backend…</p></body></html>`)

  // 예전엔 createWindow() 실패를 console.error로만 남겼다 — 패키징된 앱엔 터미널이 없어 사용자
  // 눈엔 "아무 설명 없는 검은 창"으로만 보였다(실제 버그 리포트 재현됨). 네이티브 dialog는 렌더러
  // 상태와 무관하게 항상 뜨므로, 백엔드 기동이 끝내 실패했을 때 반드시 이 경로로 사용자에게 알린다.
  async function showStartupFailure(err) {
    const detail = (err && err.message) || String(err)
    const choice = await dialog.showMessageBox(mainWindow || undefined, {
      type: 'error',
      title: 'OpenTask 백엔드를 시작하지 못했습니다 / Failed to start OpenTask backend',
      message: '백엔드 서버가 응답하지 않습니다. / The backend server is not responding.',
      detail: `${detail}\n\n"다시 시도"를 눌러 재시작해보세요. 계속 실패하면 위 로그 파일을 확인해주세요.\nClick "Retry" to restart. If it keeps failing, check the log file above.`,
      buttons: ['다시 시도 / Retry', '종료 / Quit'],
      defaultId: 0,
      cancelId: 1,
    })
    if (choice.response === 0) {
      createWindow().catch((e) => console.error('❌ OpenRM 창 재시도 실패:', (e && e.stack) || e))
    } else {
      app.quit()
    }
  }

  async function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      title: 'OpenTask',
      icon: APP_ICON_PATH,
      backgroundColor: '#0b0d10',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // "인앱 브라우저를 Electron 네이티브 <webview>로" — "브라우저" 탭이 진짜 브라우저 화면을
        // 그대로 붙이고(스크린샷 폴링 아님) 로그인 세션도 유지하려면 이 플래그가 필요하다(기본 false).
        webviewTag: true,
      },
    })
    mainWindow.setMenuBarVisibility(false)

    // 외부 링크(target=_blank — GitHub 연결, PR 링크 등) — 새 Electron 창 대신 기본 브라우저로.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    // <webview>가 붙을 때마다 게스트 페이지 쪽 preferences를 강제로 잠근다 — "브라우저" 탭은 사람이
    // 임의 URL(외부 사이트)을 여는 자리라, 게스트 안에서 Node API에 닿을 수 있으면 안 된다. src 자체는
    // 막지 않는다(범용 인앱 브라우저 — 특정 도메인으로 제한하지 않음).
    mainWindow.webContents.on('will-attach-webview', (_event, webPreferences) => {
      delete webPreferences.preload
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
    })

    mainWindow.on('closed', () => {
      mainWindow = null
    })

    mainWindow.loadURL(LOADING_DATA_URL).catch(() => {})

    let url
    try {
      url = await resolveTargetUrl()
    } catch (e) {
      console.error('❌ OpenRM 백엔드 기동 실패:', (e && e.stack) || e)
      await showStartupFailure(e)
      return
    }
    startNotifyPolling(backendApiBaseFor(url))
    await loadWithRetry(mainWindow, url)
  }

  // ── 네이티브 폴더 선택 ───────────────────────────────────────────────────
  // "레포 추가" 모달 등에서 서버 기반 FolderBrowserModal 대신 OS 기본 폴더 선택 다이얼로그를
  // 쓸 수 있게 하는 IPC 브리지. renderer는 window.openrm.pickFolder()로 호출(preload.cjs 참고).
  ipcMain.handle('openrm:pick-folder', async (_event, opts) => {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: (opts && opts.title) || '폴더 선택',
      defaultPath: (opts && opts.defaultPath) || undefined,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
    return { ok: true, path: result.filePaths[0] }
  })

  // ── 상태바 업데이트 알림 ─────────────────────────────────────────────────
  // 자동 설치(위 checkForUpdates/autoUpdater)는 공증 전까지 조용히 실패하므로, 다운로드해 쓰는
  // 사람들에게 새 버전이 있다는 것 자체를 알려줄 다른 경로가 필요하다(§ useUpdateCheck.ts). 렌더러가
  // GitHub Releases API와 직접 비교할 기준값(현재 패키징된 버전)만 여기서 내려준다.
  ipcMain.handle('openrm:get-app-version', () => app.getVersion())

  // ── 종료 동작 설정(백엔드 detached 프로세스와 별개 관심사라 SQLite 대신 파일 하나) ──────────
  // "앱을 꺼도 백엔드가 안 죽어서 세션이 계속 일한다"는 게 기본 설계 의도(§ resolveDetachedBackendUrl)
  // 지만, 정말 완전히 끄고 싶은 사용자도 있다 — 설정에서 토글로 선택하게 한다. 렌더러 state가 아니라
  // 파일로 저장하는 이유: app.on('before-quit')는 메인 프로세스에서 동기적으로 판단해야 하는데, 그
  // 시점에 렌더러에 IPC 왕복을 거는 건 창이 이미 닫히기 시작한 상태라 불안정하다.
  const ELECTRON_SETTINGS_PATH = path.join(app.getPath('userData'), 'electron-settings.json')
  function readElectronSettings() {
    try {
      return JSON.parse(fs.readFileSync(ELECTRON_SETTINGS_PATH, 'utf8'))
    } catch (_) {
      return { killBackendOnQuit: false }
    }
  }
  function writeElectronSettings(next) {
    fs.writeFileSync(ELECTRON_SETTINGS_PATH, JSON.stringify(next))
  }

  ipcMain.handle('openrm:get-quit-behavior', () => readElectronSettings())
  ipcMain.handle('openrm:set-quit-behavior', (_event, { killBackendOnQuit }) => {
    const next = { ...readElectronSettings(), killBackendOnQuit: !!killBackendOnQuit }
    writeElectronSettings(next)
    return next
  })

  // "완전 종료" 토글이 켜져 있으면, Cmd+Q 등 진짜 종료 시 detached 백엔드도 같이 내린다.
  // window-all-closed가 아니라 before-quit인 이유: macOS는 창을 다 닫아도 앱 자체는 안 죽으므로
  // (Dock에 남아 activate로 재사용) 창 닫힘과 "진짜 종료"는 다른 이벤트다.
  app.on('before-quit', () => {
    if (!readElectronSettings().killBackendOnQuit) return
    try {
      const pidFile = path.join(app.getPath('userData'), BACKEND_PIDFILE_NAME)
      const saved = JSON.parse(fs.readFileSync(pidFile, 'utf8'))
      if (saved && saved.pid && pidIsAlive(saved.pid)) {
        process.kill(saved.pid, 'SIGTERM')
        console.log(`🛑  설정에 따라 백엔드도 함께 종료 (pid ${saved.pid})`)
      }
    } catch (_) {
      // pidfile 없음/파싱 실패/이미 죽음 — 종료할 게 없으니 조용히 넘어간다.
    }
  })

  // ── 앱 메뉴 ──────────────────────────────────────────────────────────────
  // 메뉴바는 숨겨져 있지만(setMenuBarVisibility(false)) 숨김이 accelerator까지 없애주진 않는다 —
  // Electron 기본 메뉴 템플릿의 Cmd+W(창 닫기)가 살아있으면 렌더러가 같은 키를 "탭 닫기"로 쓰려는
  // preventDefault보다 먼저(OS 메뉴 레벨) 창을 닫아버린다. 그렇다고 메뉴 전체를 null로 치우면
  // macOS에서 텍스트 입력 Cmd+C/V/X/A(복사/붙여넣기/잘라내기/전체선택)까지 같이 죽는다(Electron
  // 기본 Edit 메뉴가 그 accelerator들의 출처) — 그래서 Edit 롤은 남기고 Window 메뉴에서만 close
  // 롤을 뺀 최소 커스텀 템플릿을 쓴다. Cmd+W는 이제 TabWorkspace의 keydown 핸들러가 "활성 탭 닫기"로 처리.
  function buildAppMenu() {
    const isMac = process.platform === 'darwin'
    const template = [
      ...(isMac
        ? [
            {
              label: app.name,
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
              ],
            },
          ]
        : []),
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      // Window 메뉴에 close 롤을 넣지 않음 — Cmd+W를 렌더러가 갖는다.
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ role: 'front' }] : [])] },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  // ── 자동 업데이트 ────────────────────────────────────────────────────────
  // GitHub Releases(build.publish, package.json)를 피드로 사용 — dmg는 수동 설치용,
  // Squirrel.Mac이 실제로 받아 적용하는 건 zip 타깃. Apple 서명 없이는 macOS가 업데이트 설치를
  // 거부하므로, 서명·공증 파이프라인이 붙기 전까진 아래 체크는 조용히 실패한다(비치명적).
  // 개발 모드(app.isPackaged=false)에서는 애초에 실행하지 않는다 — 로컬 electron .에는 의미 없음.
  function checkForUpdates() {
    if (!app.isPackaged) return
    autoUpdater.checkForUpdatesAndNotify().catch((e) => {
      console.warn('⚠️  업데이트 확인 실패(무시 가능):', (e && e.message) || e)
    })
  }

  app.whenReady().then(() => {
    if (process.platform === 'darwin' && fs.existsSync(APP_ICON_PATH)) {
      app.dock.setIcon(nativeImage.createFromPath(APP_ICON_PATH))
    }
    buildAppMenu()
    createWindow().catch((e) => {
      console.error('❌ OpenRM 창 초기화 실패:', (e && e.stack) || e)
    })
    checkForUpdates()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((e) => console.error('❌ OpenRM 창 재생성 실패:', (e && e.stack) || e))
    }
  })
}
