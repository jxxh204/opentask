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
})
