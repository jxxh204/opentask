/// <reference types="vite/client" />

interface Window {
	// Electron preload bridge (app/electron/preload.cjs) — absent when running in a plain browser.
	openrm?: {
		isElectron: true
		platform: string
		pickFolder(opts?: { title?: string; defaultPath?: string }): Promise<{ ok: true; path: string } | { ok: false; canceled: true }>
		getQuitBehavior(): Promise<{ killBackendOnQuit: boolean }>
		setQuitBehavior(killBackendOnQuit: boolean): Promise<{ killBackendOnQuit: boolean }>
		getAppVersion(): Promise<string>
	}
}
