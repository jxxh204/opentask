import AppKit
import WebKit

setvbuf(stdout, nil, _IONBF, 0) // 파일로 리다이렉트해도 print()가 즉시 보이게(디버깅용)

// OpenTaskShell — Electron 대체 프로토타입.
// electron/main.cjs가 하던 일: detached 백엔드 스폰/재사용/헬스체크(§BackendLauncher), window.openrm
// IPC 브리지(§OpenTaskBridge), 인앱 브라우저 탭(§BrowserPaneBridge), 알림 클릭 브리지
// (§NotificationBridge), 앱 메뉴(§AppMenu), 외부 링크를 시스템 브라우저로(§ decidePolicyFor 아래),
// 완전 종료 시 백엔드 함께 종료(§QuitBehaviorStore + applicationWillTerminate).
// 아직 없는 것: 네이티브 폴더피커의 '탭 추가(+)' 시트 앵커링 세부조정, Sparkle 오토업데이트,
// .app 번들 패키징(별도 스크립트 — scripts/build-app.sh).

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
	private var window: NSWindow?
	private var webView: WKWebView?
	private var bridgeHandler: OpenTaskBridgeHandler?
	private var paneManager: BrowserPaneManager?
	private var notificationBridge: NotificationBridge?
	private var resolvedApiBase: URL?

	func applicationDidFinishLaunching(_ notification: Notification) {
		NSApp.setActivationPolicy(.regular)
		NSApp.mainMenu = AppMenu.build()
		makeWindow()
		NSApp.activate(ignoringOtherApps: true)

		Task {
			do {
				let url = try await BackendLauncher.resolveBackendURL { [weak self] message in
					self?.bridgeHandler?.sendStartupProgress(message)
				}
				self.resolvedApiBase = url
				await MainActor.run {
					self.webView?.load(URLRequest(url: url))
					if let window = self.window {
						let bridge = NotificationBridge(apiBase: url, window: window)
						bridge.start()
						self.notificationBridge = bridge
					}
				}
			} catch {
				await MainActor.run {
					self.showFailure(error)
				}
			}
		}
	}

	func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
		true
	}

	// main.cjs의 before-quit 핸들러와 동일 — "완전 종료" 토글이 켜져 있을 때만 detached 백엔드도 내린다.
	func applicationWillTerminate(_ notification: Notification) {
		notificationBridge?.stop()
		if QuitBehaviorStore.killBackendOnQuit {
			BackendLauncher.killSavedBackendIfAny()
		}
	}

	private func makeWindow() {
		let win = NSWindow(
			contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
			styleMask: [.titled, .closable, .miniaturizable, .resizable],
			backing: .buffered,
			defer: false
		)
		win.title = "OpenTask (Swift 프로토타입)"
		win.minSize = NSSize(width: 960, height: 640)

		let container = NSView(frame: win.contentLayoutRect)
		container.autoresizingMask = [.width, .height]

		let userContentController = WKUserContentController()
		let bridgeHandler = OpenTaskBridgeHandler(appVersion: readAppVersion())
		let paneManager = BrowserPaneManager(container: container) // mainWebView는 아래에서 즉시 세팅
		userContentController.add(bridgeHandler, name: OpenTaskBridge.channelName)
		userContentController.add(paneManager, name: BrowserPaneBridge.channelName)
		userContentController.addUserScript(OpenTaskBridge.makeUserScript())
		userContentController.addUserScript(BrowserPaneBridge.makeUserScript())

		let config = WKWebViewConfiguration()
		config.userContentController = userContentController

		let webView = WKWebView(frame: container.bounds, configuration: config)
		webView.autoresizingMask = [.width, .height]
		webView.navigationDelegate = self
		container.addSubview(webView)

		bridgeHandler.webView = webView
		bridgeHandler.pickFolderAnchorWindow = win
		paneManager.setMainWebView(webView)

		win.contentView = container
		win.center()
		win.makeKeyAndOrderFront(nil)

		self.window = win
		self.webView = webView
		self.bridgeHandler = bridgeHandler
		self.paneManager = paneManager

		loadStartupMessage("백엔드를 시작하는 중입니다…")
	}

	private func readAppVersion() -> String {
		// electron-builder가 아니라 app/package.json의 version 필드를 그대로 읽는다(단일 진실 소스 유지 —
		// 이 프로토타입만의 별도 버전 번호를 만들지 않는다).
		let repoRoot = URL(fileURLWithPath: #filePath)
			.deletingLastPathComponent()
			.deletingLastPathComponent()
			.deletingLastPathComponent()
		let pkgPath = repoRoot.appendingPathComponent("app/package.json")
		guard let data = try? Data(contentsOf: pkgPath),
			let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
			let version = json["version"] as? String
		else { return "0.0.0-swift-proto" }
		return version
	}

	private func loadStartupMessage(_ message: String) {
		let html = """
		<!doctype html><html><head><meta charset="utf-8"></head>
		<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
		background:#0b0d10;color:#9aa4af;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
		<p>\(message)</p></body></html>
		"""
		webView?.loadHTMLString(html, baseURL: nil)
	}

	private func showFailure(_ error: Error) {
		loadStartupMessage("백엔드 시작 실패: \(error)")
		let alert = NSAlert()
		alert.alertStyle = .critical
		alert.messageText = "OpenTask 백엔드를 시작하지 못했습니다"
		alert.informativeText = "\(error)"
		alert.addButton(withTitle: "확인")
		alert.runModal()
	}

	// main.cjs will-navigate/setWindowOpenHandler와 동일 — 메인 창 자기 origin이 아닌 곳으로 이동하려는
	// 요청(외부 링크, target=_blank)은 막고 시스템 기본 브라우저로 대신 연다.
	func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
		guard navigationAction.targetFrame?.isMainFrame == true, let requestURL = navigationAction.request.url else {
			// 새 창 요청(target=_blank) — 항상 외부로.
			if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
			decisionHandler(.cancel)
			return
		}
		let currentOrigin = webView.url.flatMap { origin(of: $0) }
		let targetOrigin = origin(of: requestURL)
		if let resolvedApiBase, let currentOrigin, currentOrigin == origin(of: resolvedApiBase), targetOrigin != currentOrigin {
			NSWorkspace.shared.open(requestURL)
			decisionHandler(.cancel)
			return
		}
		decisionHandler(.allow)
	}

	private func origin(of url: URL) -> String? {
		guard let scheme = url.scheme, let host = url.host else { return nil }
		return "\(scheme)://\(host):\(url.port ?? -1)"
	}
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
