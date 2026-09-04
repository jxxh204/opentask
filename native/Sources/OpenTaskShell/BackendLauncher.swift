import Foundation

// BackendLauncher — electron/main.cjs의 resolveDetachedBackendUrl()을 Swift로 옮긴 것.
// Phase 1 프로토타입 범위: 포트 스캔(빈 포트 찾기)은 생략하고 고정 포트 하나만 시도한다 — 이미 실행
// 중인 Electron 앱(개발용 18771)과 절대 겹치지 않도록 별도 기본 포트(18781) + 별도 데이터 디렉토리를
// 쓴다. 두 앱을 나란히 띄워 비교 검증하는 게 이번 단계의 목적이라, 서로의 데이터/포트를 침범하면 안 됨.
enum BackendLauncher {
	struct LaunchError: Error, CustomStringConvertible {
		let description: String
	}

	// electron/main.cjs의 FILE_ENV_DEFAULTS와 동일 — server/index.cjs가 요구하는 env var 목록.
	// 프로토타입은 별도 데이터 디렉토리를 쓰므로 실제 앱의 데이터를 절대 건드리지 않는다.
	private static let fileEnvDefaults: [String: String] = [
		"OPENRM_DEPLOYS_FILE": ".openrm-deploys.json",
		"OPENRM_SESSIONS_FILE": ".openrm-sessions.json",
		"OPENRM_ALERTS_FILE": ".openrm-alerts.json",
		"OPENRM_PROMPTS_FILE": ".openrm-prompts.json",
		"OPENRM_SETTINGS_FILE": ".openrm-settings.json",
		"OPENRM_TASKS_FILE": ".openrm-tasks.json",
		"OPENRM_JOBFAILS_FILE": ".openrm-jobfails.json",
		"OPENRM_NOTION_TITLES": ".openrm-notion-titles.json",
		"OPENRM_ORCH_FILE": ".openrm-orch.json",
	]

	private static var appSupportRoot: URL {
		let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
		return base.appendingPathComponent("OpenTask-swift-proto", isDirectory: true)
	}

	private static var dataDir: URL { appSupportRoot.appendingPathComponent("data", isDirectory: true) }
	private static var pidFileURL: URL { appSupportRoot.appendingPathComponent("backend.json") }
	private static var logFileURL: URL { appSupportRoot.appendingPathComponent("backend.log") }

	// serverEntry — 이 스위프트 패키지가 `<repo>/native`에 있으므로 server/index.cjs는 `../app/server/index.cjs`.
	private static var serverEntryPath: String {
		let repoRoot = URL(fileURLWithPath: #filePath)
			.deletingLastPathComponent() // BackendLauncher.swift 제거 → OpenTaskShell/
			.deletingLastPathComponent() // → Sources/
			.deletingLastPathComponent() // → native/
			.deletingLastPathComponent() // → <repo root>
		return repoRoot
			.appendingPathComponent("app")
			.appendingPathComponent("server")
			.appendingPathComponent("index.cjs")
			.path
	}

	private static func pidIsAlive(_ pid: Int32) -> Bool {
		kill(pid, 0) == 0
	}

	private static func pingHealth(url: URL, timeout: TimeInterval = 1.5) async -> Bool {
		var request = URLRequest(url: url)
		request.timeoutInterval = timeout
		guard let (data, _) = try? await URLSession.shared.data(for: request) else { return false }
		guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
		return (json["ok"] as? Bool) == true
	}

	private static func waitForHealthy(url: URL, attempts: Int = 60, intervalMs: UInt64 = 500) async -> Bool {
		for _ in 0..<attempts {
			if await pingHealth(url: url) { return true }
			try? await Task.sleep(nanoseconds: intervalMs * 1_000_000)
		}
		return false
	}

	private static func setDataEnv(port: Int) -> [String: String] {
		try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
		var env = ProcessInfo.processInfo.environment
		env["OPENRM_DATA_DIR"] = dataDir.path
		for (key, filename) in fileEnvDefaults {
			env[key] = dataDir.appendingPathComponent(filename).path
		}
		env["OPENRM_PORT"] = String(port)
		return env
	}

	/// 완전 종료 시(§ QuitBehaviorStore.killBackendOnQuit) pidfile에서 백엔드 pid를 읽어 종료시킨다.
	static func killSavedBackendIfAny() {
		guard let data = try? Data(contentsOf: pidFileURL),
			let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
			let pid = saved["pid"] as? Int32,
			pidIsAlive(pid)
		else { return }
		kill(pid, SIGTERM)
		print("🛑  설정에 따라 백엔드도 함께 종료 (pid \(pid))")
	}

	/// 기존 백엔드(이전 실행에서 살아남은 것)를 재사용하거나, 새로 스폰해서 healthy가 될 때까지 기다린 뒤
	/// 프론트엔드가 로드할 URL을 반환한다.
	static func resolveBackendURL(onProgress: (@MainActor (String) -> Void)? = nil) async throws -> URL {
		let host = "127.0.0.1"
		let port = Int(ProcessInfo.processInfo.environment["OPENTASK_SWIFT_PORT"] ?? "") ?? 18781
		let url = URL(string: "http://\(host):\(port)/")!
		let healthUrl = url.appendingPathComponent("api/health")

		try? FileManager.default.createDirectory(at: appSupportRoot, withIntermediateDirectories: true)
		await onProgress?("기존 백엔드 확인 중…")

		// 1) 기존 백엔드 재사용 시도 (pidfile + 생존 확인 + 헬스체크)
		if let data = try? Data(contentsOf: pidFileURL),
			let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
			let pid = saved["pid"] as? Int32,
			pidIsAlive(pid),
			await pingHealth(url: healthUrl)
		{
			print("♻️  기존 백엔드 재사용 (pid \(pid)) — \(url)")
			await onProgress?("기존 백엔드에 연결됐습니다")
			return url
		}

		// 2) 새로 스폰 — Node 프로세스는 detached child_process와 동일하게, 이 Swift 프로세스가 종료돼도
		//    (부모가 죽으면 POSIX 규칙상 launchd로 reparent됨) 살아남는다. 별도 detach 처리 불필요.
		guard FileManager.default.fileExists(atPath: serverEntryPath) else {
			throw LaunchError(description: "server/index.cjs를 찾을 수 없음: \(serverEntryPath)")
		}
		try? FileManager.default.createDirectory(at: appSupportRoot, withIntermediateDirectories: true)
		if !FileManager.default.fileExists(atPath: logFileURL.path) {
			FileManager.default.createFile(atPath: logFileURL.path, contents: nil)
		}
		let logHandle = try FileHandle(forWritingTo: logFileURL)
		defer { try? logHandle.close() }
		logHandle.seekToEndOfFile()

		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
		process.arguments = ["node", serverEntryPath]
		process.environment = setDataEnv(port: port)
		process.currentDirectoryURL = URL(fileURLWithPath: serverEntryPath)
			.deletingLastPathComponent()
			.deletingLastPathComponent()
		process.standardOutput = logHandle
		process.standardError = logHandle

		do {
			try process.run()
		} catch {
			throw LaunchError(description: "백엔드 프로세스 실행 실패: \(error)")
		}

		let pidJson = try JSONSerialization.data(withJSONObject: ["pid": process.processIdentifier, "port": port, "startedAt": Date().timeIntervalSince1970])
		try pidJson.write(to: pidFileURL)

		print("🚀  백엔드 새로 기동 중 (pid \(process.processIdentifier)) — \(url)")
		await onProgress?("백엔드 프로세스 시작됨 — 응답 대기 중…")
		let healthy = await waitForHealthy(url: healthUrl)
		guard healthy else {
			throw LaunchError(description: "백엔드가 응답하지 않습니다(포트: \(port), 로그: \(logFileURL.path))")
		}
		print("✅  백엔드 준비 완료 — \(url)")
		await onProgress?("백엔드 준비 완료")
		return url
	}
}
