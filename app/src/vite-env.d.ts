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
		onStartupProgress(cb: (message: string) => void): () => void
	}

	// 네이티브 셸(native/ Swift 프로토타입)의 인앱 브라우저 브리지 — Electron 전용 <webview> 태그를
	// WKWebView로 대체(§app/src/components/sessions/BrowserPane.tsx). Electron 위에서 돌 때는 이게
	// 없고 <webview>를 직접 쓴다 — 두 셸이 공존하는 동안 BrowserPane이 런타임에 둘 중 있는 쪽을 쓴다.
	openrmBrowserPane?: {
		create(id: string, url: string): void
		setRect(id: string, rect: { x: number; y: number; width: number; height: number } | null): void
		navigate(id: string, url: string): void
		goBack(id: string): void
		goForward(id: string): void
		reload(id: string): void
		openDevTools(id: string): void
		evaluateJavaScript(id: string, script: string): Promise<unknown>
		close(id: string): void
		onEvent(
			id: string,
			cb: (
				event:
					| { type: 'state'; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }
					| { type: 'fail'; errorCode: number; errorDescription: string }
			) => void
		): () => void
	}
}
