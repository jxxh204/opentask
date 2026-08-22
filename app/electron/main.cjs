#!/usr/bin/env node
// electron/main.cjs — OpenRM 데스크톱 셸.
// 기존 server/index.cjs(HTTP+WS, 무변경)를 in-process로 구동하고 BrowserWindow가
// http://127.0.0.1:<port>를 로드한다 (file:// 아님 — BrowserRouter/상대경로 fetch 무변경 유지).
// dev 모드에선 ELECTRON_START_URL(Vite dev server, 기본 :5180)을 그대로 로드 — 백엔드는
// `yarn dev`/`yarn start`가 이미 별도 프로세스로 띄운다(HMR 유지, 기존 dev 워크플로 무변경).
'use strict'

const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

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

  async function resolveTargetUrl() {
    const devUrl = process.env.ELECTRON_START_URL
    if (devUrl) return devUrl

    // 패키징/프로덕션: 백엔드를 in-process로 직접 구동하고 그 포트를 로드.
    setDataEnv()
    const { startServer } = require('../server/index.cjs')
    const { port, host } = await startServer({
      port: Number(process.env.OPENRM_PORT || 8770),
      host: '127.0.0.1',
    })
    return `http://${host}:${port}/`
  }

  async function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      title: 'OpenTask',
      backgroundColor: '#0b0d10',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    mainWindow.setMenuBarVisibility(false)

    // 외부 링크(target=_blank — GitHub 연결, PR 링크 등) — 새 Electron 창 대신 기본 브라우저로.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    mainWindow.on('closed', () => {
      mainWindow = null
    })

    const url = await resolveTargetUrl()
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

  app.whenReady().then(() => {
    buildAppMenu()
    createWindow().catch((e) => {
      console.error('❌ OpenRM 창 초기화 실패:', (e && e.stack) || e)
    })
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
