// electron/preload.cjs — contextIsolation:true + sandbox:true 렌더러용 최소 브리지.
'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('openrm', {
  isElectron: true,
  platform: process.platform,
  // OS 기본 폴더 선택 다이얼로그 (main.cjs의 ipcMain.handle('openrm:pick-folder') 참고).
  // 취소 시 { ok: false, canceled: true }, 선택 시 { ok: true, path }.
  pickFolder: (opts) => ipcRenderer.invoke('openrm:pick-folder', opts),
  // "완전 종료 시 백엔드도 같이 끌지" 토글 (설정 모달, main.cjs의 before-quit 참고).
  getQuitBehavior: () => ipcRenderer.invoke('openrm:get-quit-behavior'),
  setQuitBehavior: (killBackendOnQuit) => ipcRenderer.invoke('openrm:set-quit-behavior', { killBackendOnQuit }),
  // 상태바 업데이트 알림용(§ SessionShell.tsx useUpdateCheck) — 패키징된 실제 버전 문자열이 필요하다.
  getAppVersion: () => ipcRenderer.invoke('openrm:get-app-version'),
  // "서버 연동... 로딩에는 어떤 연동이 진행되고있는지 실시간으로" — 이 프리로드는 로딩 화면(§
  // main.cjs LOADING_DATA_URL, data: URL)에도 그대로 붙는다(BrowserWindow의 preload는 로드된 URL
  // 스킴과 무관하게 항상 적용됨). 백엔드 기동 단계마다 메인 프로세스가 쏘는 진행 메시지를 그 화면이
  // 구독한다. 구독 해제 함수를 돌려줘 페이지가 실제 앱으로 넘어갈 때(언마운트) 리스너가 안 쌓이게 한다.
  onStartupProgress: (cb) => {
    const listener = (_event, message) => cb(message)
    ipcRenderer.on('openrm:startup-progress', listener)
    return () => ipcRenderer.removeListener('openrm:startup-progress', listener)
  },
})
