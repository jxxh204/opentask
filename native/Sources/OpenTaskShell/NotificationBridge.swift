import AppKit
import UserNotifications

// NotificationBridge — main.cjs의 "알림 클릭 브리지"(§ startNotifyPolling) 이식.
// server/notify.cjs가 5초 폴링으로 heartbeat를 받고, 띄울 알림 큐(pending)를 이 프로세스가 대신 꺼내
// UNUserNotificationCenter로 진짜 클릭 가능한 알림을 띄운다. 클릭하면 메인 창을 포커스한다.
@MainActor
final class NotificationBridge: NSObject, UNUserNotificationCenterDelegate {
	private let apiBase: URL
	private var timer: Timer?
	private weak var window: NSWindow?

	// UNUserNotificationCenter는 제대로 된 .app 번들(CFBundleIdentifier가 있는)에서 실행 중이어야만
	// 쓸 수 있다 — 번들 없이(`swift run`/raw 실행 파일) 부르면 즉시 크래시한다(bundleProxyForCurrentProcess
	// nil, 실측됨). 패키징 전 로컬 개발 실행을 죽이지 않도록 번들 여부를 감지해 없으면 조용히 비활성화.
	private let hasProperBundle = Bundle.main.bundleIdentifier != nil

	init(apiBase: URL, window: NSWindow) {
		self.apiBase = apiBase
		self.window = window
		super.init()
		guard hasProperBundle else {
			print("⚠️  NotificationBridge: .app 번들 밖(raw 실행 파일)이라 알림 비활성화 — 패키징 후 자동 활성화됨")
			return
		}
		UNUserNotificationCenter.current().delegate = self
	}

	func start() {
		guard hasProperBundle else { return }
		UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
		poll()
		let t = Timer(timeInterval: 5.0, repeats: true) { [weak self] _ in
			Task { @MainActor in self?.poll() }
		}
		RunLoop.main.add(t, forMode: .common)
		timer = t
	}

	func stop() {
		timer?.invalidate()
		timer = nil
	}

	private func poll() {
		Task {
			do {
				var heartbeatReq = URLRequest(url: apiBase.appendingPathComponent("api/notify/heartbeat"))
				heartbeatReq.httpMethod = "POST"
				_ = try? await URLSession.shared.data(for: heartbeatReq)

				let (data, _) = try await URLSession.shared.data(from: apiBase.appendingPathComponent("api/notify/pending"))
				guard let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
					(body["ok"] as? Bool) == true,
					let items = body["items"] as? [[String: Any]]
				else { return }
				for item in items {
					show(title: item["title"] as? String ?? "OpenTask", body: item["body"] as? String ?? "")
				}
			} catch {
				// 백엔드가 잠깐 안 뜨는 중 — 다음 폴링에서 재시도, 조용히 무시.
			}
		}
	}

	private func show(title: String, body: String) {
		let content = UNMutableNotificationContent()
		content.title = title
		content.body = body
		let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
		UNUserNotificationCenter.current().add(request)
	}

	// 알림 클릭 → 창 포커스(§ main.cjs Notification.on('click')와 동일 동작).
	nonisolated func userNotificationCenter(
		_ center: UNUserNotificationCenter,
		didReceive response: UNNotificationResponse,
		withCompletionHandler completionHandler: @escaping () -> Void
	) {
		Task { @MainActor in
			if let window {
				if window.isMiniaturized { window.deminiaturize(nil) }
				window.makeKeyAndOrderFront(nil)
				NSApp.activate(ignoringOtherApps: true)
			}
			completionHandler()
		}
	}

	// 앱이 포그라운드에 있어도 배너를 보여준다(기본값은 포그라운드일 때 무음 처리라 알림이 씹힌 것처럼 보임).
	nonisolated func userNotificationCenter(
		_ center: UNUserNotificationCenter,
		willPresent notification: UNNotification,
		withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
	) {
		completionHandler([.banner, .sound])
	}
}
