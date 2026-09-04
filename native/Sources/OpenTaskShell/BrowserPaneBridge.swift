import AppKit
import WebKit

// BrowserPaneBridge — Electron 전용 <webview> 태그(BrowserPane.tsx)를 대체.
// WKWebView는 <webview>와 달리 다른 웹뷰의 DOM 안에 HTML 태그로 못 들어간다(네이티브 NSView라서) —
// 그래서 React 쪽은 자리만 잡는 placeholder <div>를 렌더링하고, 그 div의 화면 좌표(getBoundingClientRect)를
// 이 브리지로 흘려보내면 네이티브가 진짜 WKWebView를 그 좌표에 겹쳐(overlay) 그린다. 파티션은 모든 pane이
// WKWebsiteDataStore.default()를 공유해 로그인 세션이 유지된다(§BrowserPane.tsx PARTITION과 동일 효과 —
// 이 앱엔 pane이 이것뿐이라 default 하나로 충분, 태스크별 격리가 필요해지면 그때 named store로 쪼갠다).
enum BrowserPaneBridge {
	static let channelName = "openrmBrowserPane"

	static let bridgeScript = """
	(function(){
	  if (window.openrmBrowserPane) return;
	  var pending = {};
	  var counter = 0;
	  var eventListeners = {};
	  function post(method, id, args, reqId) {
	    window.webkit.messageHandlers.openrmBrowserPane.postMessage({ reqId: reqId || null, id: id, method: method, args: args || {} });
	  }
	  function call(method, id, args) {
	    return new Promise(function(resolve){
	      var reqId = String(++counter);
	      pending[reqId] = resolve;
	      post(method, id, args, reqId);
	    });
	  }
	  window.__openrmPaneResolve = function(reqId, result) {
	    var cb = pending[reqId];
	    delete pending[reqId];
	    if (cb) cb(result);
	  };
	  window.__openrmPaneEvent = function(id, evt) {
	    (eventListeners[id] || []).slice().forEach(function(cb){ cb(evt); });
	  };
	  window.openrmBrowserPane = {
	    create: function(id, url, opts) { post('create', id, { url: url, partition: opts && opts.partition }); },
	    setRect: function(id, rect) { post('setRect', id, { rect: rect }); },
	    navigate: function(id, url) { post('navigate', id, { url: url }); },
	    goBack: function(id) { post('goBack', id, {}); },
	    goForward: function(id) { post('goForward', id, {}); },
	    reload: function(id) { post('reload', id, {}); },
	    openDevTools: function(id) { post('openDevTools', id, {}); },
	    evaluateJavaScript: function(id, script) { return call('evaluateJavaScript', id, { script: script }); },
	    close: function(id) { post('close', id, {}); delete eventListeners[id]; },
	    onEvent: function(id, cb) {
	      (eventListeners[id] = eventListeners[id] || []).push(cb);
	      return function(){
	        var arr = eventListeners[id];
	        if (!arr) return;
	        var idx = arr.indexOf(cb);
	        if (idx >= 0) arr.splice(idx, 1);
	      };
	    },
	  };
	})();
	"""

	static func makeUserScript() -> WKUserScript {
		WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
	}
}

@MainActor
final class BrowserPaneInstance: NSObject, WKNavigationDelegate {
	let id: String
	let webView: WKWebView
	weak var manager: BrowserPaneManager?
	private var kvoTokens: [NSKeyValueObservation] = []

	init(id: String, manager: BrowserPaneManager) {
		self.id = id
		self.manager = manager
		let config = WKWebViewConfiguration()
		config.websiteDataStore = .default() // 모든 pane이 공유 — 로그인 세션 유지(§ 파일 상단 주석)
		self.webView = WKWebView(frame: .zero, configuration: config)
		super.init()
		webView.navigationDelegate = self
		if #available(macOS 13.3, *) {
			webView.isInspectable = true // 우클릭 → "Inspect Element"로 Safari Web Inspector 붙일 수 있음
		}
		webView.allowsBackForwardNavigationGestures = true
		observeState()
	}

	private func observeState() {
		let handler: () -> Void = { [weak self] in self?.pushState() }
		kvoTokens = [
			webView.observe(\.url, options: [.new]) { _, _ in handler() },
			webView.observe(\.isLoading, options: [.new]) { _, _ in handler() },
			webView.observe(\.canGoBack, options: [.new]) { _, _ in handler() },
			webView.observe(\.canGoForward, options: [.new]) { _, _ in handler() },
		]
	}

	private func pushState() {
		manager?.pushEvent(
			id: id,
			event: [
				"type": "state",
				"url": webView.url?.absoluteString ?? "",
				"loading": webView.isLoading,
				"canGoBack": webView.canGoBack,
				"canGoForward": webView.canGoForward,
			]
		)
	}

	func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
		pushFailure(error)
	}

	func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
		pushFailure(error)
	}

	private func pushFailure(_ error: Error) {
		let nsError = error as NSError
		if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return } // 리다이렉트 등 흔한 취소, 무시
		manager?.pushEvent(id: id, event: ["type": "fail", "errorCode": nsError.code, "errorDescription": nsError.localizedDescription])
	}
}

@MainActor
final class BrowserPaneManager: NSObject, WKScriptMessageHandler {
	private weak var container: NSView?
	private weak var mainWebView: WKWebView?
	private var panes: [String: BrowserPaneInstance] = [:]

	// container에 pane webview를 얹으려면 먼저 있어야 하지만, mainWebView(이벤트를 쏘아 보낼 대상)는
	// 그 자신의 WKUserContentController가 이 매니저를 message handler로 물고 있어야 생성 가능하다 —
	// 순환 의존이라 mainWebView는 생성 뒤 별도로 주입한다(§ main.swift makeWindow).
	init(container: NSView) {
		self.container = container
	}

	func setMainWebView(_ webView: WKWebView) {
		self.mainWebView = webView
	}

	func pushEvent(id: String, event: [String: Any]) {
		guard let mainWebView else { return }
		let idJson = OpenTaskBridgeHandler.jsonString(id)
		let evtJson = OpenTaskBridgeHandler.jsonString(event)
		mainWebView.evaluateJavaScript("window.__openrmPaneEvent && window.__openrmPaneEvent(\(idJson), \(evtJson))")
	}

	func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
		guard let body = message.body as? [String: Any],
			let id = body["id"] as? String,
			let method = body["method"] as? String
		else { return }
		let args = body["args"] as? [String: Any] ?? [:]
		let reqId = body["reqId"] as? String

		switch method {
		case "create":
			ensurePane(id: id)
			if let urlStr = args["url"] as? String, let url = URL(string: urlStr) {
				panes[id]?.webView.load(URLRequest(url: url))
			}
		case "setRect":
			setRect(id: id, rectArgs: args["rect"] as? [String: Any])
		case "navigate":
			if let urlStr = args["url"] as? String, let url = URL(string: urlStr) {
				panes[id]?.webView.load(URLRequest(url: url))
			}
		case "goBack": panes[id]?.webView.goBack()
		case "goForward": panes[id]?.webView.goForward()
		case "reload": panes[id]?.webView.reload()
		case "openDevTools": break // isInspectable=true라 우클릭 메뉴로 대체 — 프로그래매틱 오픈 API 없음
		case "evaluateJavaScript":
			let script = args["script"] as? String ?? ""
			guard let reqId else { return }
			Task { @MainActor in
				let result = await self.runScript(id: id, script: script)
				guard let mainWebView = self.mainWebView else { return }
				let json = OpenTaskBridgeHandler.jsonString(result)
				mainWebView.evaluateJavaScript("window.__openrmPaneResolve(\"\(reqId)\", \(json))", completionHandler: nil)
			}
		case "close":
			closePane(id: id)
		default:
			break
		}
	}

	private func ensurePane(id: String) {
		guard panes[id] == nil, let container else { return }
		let pane = BrowserPaneInstance(id: id, manager: self)
		pane.webView.isHidden = true // setRect가 실제 위치를 주기 전까지 숨김(0,0 겹침 방지)
		container.addSubview(pane.webView, positioned: .above, relativeTo: nil)
		panes[id] = pane
	}

	private func setRect(id: String, rectArgs: [String: Any]?) {
		guard let pane = panes[id], let container else { return }
		guard let rectArgs,
			let x = rectArgs["x"] as? Double,
			let y = rectArgs["y"] as? Double,
			let w = rectArgs["width"] as? Double,
			let h = rectArgs["height"] as? Double,
			w > 0, h > 0
		else {
			pane.webView.isHidden = true
			return
		}
		// CSS(원점 좌상단, y-down) → AppKit(원점 좌하단, y-up) 변환.
		let containerHeight = container.bounds.height
		let flippedY = containerHeight - y - h
		pane.webView.frame = NSRect(x: x, y: flippedY, width: w, height: h)
		pane.webView.isHidden = false
	}

	private func runScript(id: String, script: String) async -> Any {
		guard let pane = panes[id] else { return NSNull() }
		return await withCheckedContinuation { continuation in
			pane.webView.evaluateJavaScript(script) { result, error in
				if let error {
					continuation.resume(returning: ["ok": false, "error": String(describing: error)])
				} else {
					continuation.resume(returning: result ?? NSNull())
				}
			}
		}
	}

	private func closePane(id: String) {
		guard let pane = panes[id] else { return }
		pane.webView.removeFromSuperview()
		panes[id] = nil
	}
}
