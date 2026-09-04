import AppKit
import WebKit

// OpenTaskBridge — electron/preload.cjs(window.openrm contextBridge)와 정확히 같은 계약을 재현하는
// WKScriptMessageHandler 기반 IPC. 프론트엔드(app/src)는 이 계약만 보고 짜여 있어서(vite-env.d.ts),
// 이 파일이 그 계약을 그대로 채워주는 한 React 쪽 코드는 한 글자도 안 바꿔도 된다.
//
// 동작 방식: 문서 로드 시점에 아래 BRIDGE_SCRIPT를 주입해 window.openrm.*를 정의한다. 각 메서드는
// window.webkit.messageHandlers.openrm.postMessage({id, method, args})로 네이티브를 부르고, 네이티브는
// 처리 후 evaluateJavaScript로 window.__openrmResolve(id, json)을 호출해 그 Promise를 resolve한다.
enum OpenTaskBridge {
	static let channelName = "openrm"

	static let bridgeScript = """
	(function(){
	  if (window.openrm) return; // 중복 주입 방지
	  var pending = {};
	  var counter = 0;
	  function callNative(method, args) {
	    return new Promise(function(resolve){
	      var id = String(++counter);
	      pending[id] = resolve;
	      window.webkit.messageHandlers.openrm.postMessage({ id: id, method: method, args: args || {} });
	    });
	  }
	  window.__openrmResolve = function(id, result) {
	    var cb = pending[id];
	    delete pending[id];
	    if (cb) cb(result);
	  };
	  var progressListeners = [];
	  window.__openrmProgress = function(message) {
	    progressListeners.slice().forEach(function(cb){ cb(message); });
	  };
	  window.openrm = {
	    isElectron: true,
	    platform: 'darwin',
	    pickFolder: function(opts) { return callNative('pickFolder', opts); },
	    getQuitBehavior: function() { return callNative('getQuitBehavior'); },
	    setQuitBehavior: function(killBackendOnQuit) { return callNative('setQuitBehavior', { killBackendOnQuit: killBackendOnQuit }); },
	    getAppVersion: function() { return callNative('getAppVersion'); },
	    onStartupProgress: function(cb) {
	      progressListeners.push(cb);
	      return function(){
	        var idx = progressListeners.indexOf(cb);
	        if (idx >= 0) progressListeners.splice(idx, 1);
	      };
	    },
	  };
	})();
	"""

	static func makeUserScript() -> WKUserScript {
		WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
	}
}

// electron-settings.json(main.cjs readElectronSettings/writeElectronSettings)과 동일한 역할 —
// "완전 종료 시 백엔드도 같이 끌지" 토글을 UserDefaults에 저장한다.
enum QuitBehaviorStore {
	private static let key = "killBackendOnQuit"

	static var killBackendOnQuit: Bool {
		get { UserDefaults.standard.bool(forKey: key) }
		set { UserDefaults.standard.set(newValue, forKey: key) }
	}
}

@MainActor
final class OpenTaskBridgeHandler: NSObject, WKScriptMessageHandler {
	weak var webView: WKWebView?
	var pickFolderAnchorWindow: NSWindow?
	var appVersion: String

	init(appVersion: String) {
		self.appVersion = appVersion
	}

	func sendStartupProgress(_ message: String) {
		guard let webView else { return }
		let escaped = OpenTaskBridgeHandler.jsonString(message)
		webView.evaluateJavaScript("window.__openrmProgress && window.__openrmProgress(\(escaped))")
	}

	func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
		guard let body = message.body as? [String: Any],
			let id = body["id"] as? String,
			let method = body["method"] as? String
		else { return }
		let args = body["args"] as? [String: Any] ?? [:]

		Task { @MainActor in
			let result = await handle(method: method, args: args)
			self.resolve(id: id, result: result)
		}
	}

	private func resolve(id: String, result: Any) {
		guard let webView else { return }
		let json = OpenTaskBridgeHandler.jsonString(result)
		webView.evaluateJavaScript("window.__openrmResolve(\"\(id)\", \(json))")
	}

	private func handle(method: String, args: [String: Any]) async -> Any {
		switch method {
		case "pickFolder":
			return await pickFolder(title: args["title"] as? String, defaultPath: args["defaultPath"] as? String)
		case "getQuitBehavior":
			return ["killBackendOnQuit": QuitBehaviorStore.killBackendOnQuit]
		case "setQuitBehavior":
			let next = (args["killBackendOnQuit"] as? Bool) ?? false
			QuitBehaviorStore.killBackendOnQuit = next
			return ["killBackendOnQuit": next]
		case "getAppVersion":
			return appVersion
		default:
			return NSNull()
		}
	}

	private func pickFolder(title: String?, defaultPath: String?) async -> [String: Any] {
		await withCheckedContinuation { continuation in
			let panel = NSOpenPanel()
			panel.title = title ?? "폴더 선택"
			panel.canChooseFiles = false
			panel.canChooseDirectories = true
			panel.canCreateDirectories = true
			panel.allowsMultipleSelection = false
			if let defaultPath, !defaultPath.isEmpty {
				panel.directoryURL = URL(fileURLWithPath: defaultPath)
			}
			let completion: (NSApplication.ModalResponse) -> Void = { response in
				if response == .OK, let url = panel.urls.first {
					continuation.resume(returning: ["ok": true, "path": url.path])
				} else {
					continuation.resume(returning: ["ok": false, "canceled": true])
				}
			}
			if let anchor = pickFolderAnchorWindow {
				panel.beginSheetModal(for: anchor, completionHandler: completion)
			} else {
				completion(panel.runModal())
			}
		}
	}

	// JSONSerialization은 최상위가 배열/딕셔너리여야 하므로 문자열은 감싸서 인코딩 후 다시 풀어낸다.
	static func jsonString(_ value: Any) -> String {
		if let data = try? JSONSerialization.data(withJSONObject: ["v": value]),
			let str = String(data: data, encoding: .utf8)
		{
			// {"v":<value>} 에서 <value> 부분만 추출
			let prefix = "{\"v\":"
			if str.hasPrefix(prefix), str.hasSuffix("}") {
				return String(str.dropFirst(prefix.count).dropLast())
			}
		}
		return "null"
	}
}
