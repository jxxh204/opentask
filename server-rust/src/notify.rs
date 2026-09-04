// notify.rs — app/server/notify.cjs 이식 중 orchestrator.cjs가 실제로 쓰는 부분만: 에스컬레이션
// 알림 큐(Electron/Swift 셸이 heartbeat+pending 폴링으로 대신 띄움) + osascript 폴백.
//
// ⚠️ 축소 지점: tick()(세션 상태 전이 감시 → 자동 완료/질문대기/인증필요 알림)은 미포팅 — Term.listLive()의
// working/waiting/needsAuth 판정이 화면 상태 해석에 깊게 의존해 별도 스코프다. notifyEscalation()(호출부가
// 직접 판단해 부르는 것 — orchestrator.cjs가 쓰는 것)만 이식.
use serde_json::{json, Value};
use std::sync::Mutex;

struct NotifyState {
	pending: Vec<(String, String)>,
	last_heartbeat_ms: i64,
}

static STATE: std::sync::LazyLock<Mutex<NotifyState>> = std::sync::LazyLock::new(|| Mutex::new(NotifyState { pending: Vec::new(), last_heartbeat_ms: 0 }));

pub fn heartbeat() {
	STATE.lock().unwrap().last_heartbeat_ms = chrono::Utc::now().timestamp_millis();
}

fn shell_alive() -> bool {
	let now = chrono::Utc::now().timestamp_millis();
	now - STATE.lock().unwrap().last_heartbeat_ms < 8000 // 셸(Electron/Swift) 폴링 주기(5초)의 여유
}

fn enqueue(title: &str, body: &str) {
	let mut s = STATE.lock().unwrap();
	s.pending.push((title.to_string(), body.to_string()));
	if s.pending.len() > 20 {
		s.pending.remove(0);
	}
}

pub fn drain_pending() -> Vec<Value> {
	let mut s = STATE.lock().unwrap();
	s.pending.drain(..).map(|(title, body)| json!({"title": title, "body": body})).collect()
}

fn notify_mac(title: &str, body: &str) {
	let script = format!("display notification {} with title {} sound name \"Glass\"", json!(body), json!(title));
	let _ = std::process::Command::new("osascript").args(["-e", &script]).spawn();
}

fn fire(title: &str, body: &str) {
	if shell_alive() {
		enqueue(title, body);
	} else {
		notify_mac(title, body);
	}
}

/// 에스컬레이션(§12) — 세션 상태 전이 감시가 아니라 호출부가 직접 판단해 부르는 이벤트(리뷰 재요청 초과,
/// 서브태스크 막힘, 체인 완료 등). agentNotify 설정이 꺼져 있으면 조용히 무시.
pub fn notify_escalation(title: &str, body: &str) {
	let enabled = crate::settings::load().get("agentNotify").and_then(Value::as_bool).unwrap_or(true);
	if !enabled {
		return;
	}
	fire(&format!("🚨 {title}"), body);
}
