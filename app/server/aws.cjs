// aws.cjs — AWS MFA 세션 갱신 (모니터 탭에서 6자리 코드 입력 → mfa 프로필 임시 토큰 자동 기록).
// 표준 흐름: [default] 영구키 + mfa_serial → `aws sts get-session-token --token-code <6자리>`
//           → 받은 임시 자격증명을 [mfa] 프로필(~/.aws/credentials)에 기록 → Claude 루프가 즉시 사용.
// ⚠️ 읽기 전용 설계 — 이 파일이 호출하는 AWS API는 sts get-session-token(임시 토큰 발급, 리소스 변경
// 없음)과 sts get-caller-identity(신원 조회)뿐이다. EC2/S3 등 리소스를 만들거나 지우는 호출은 없다.
// mfa 프로필로 실제 무엇을 할 수 있는지는 그 IAM 사용자/역할에 연결된 정책이 결정 — 리소스 변경을
// 막으려면 AWS 쪽에서 해당 사용자에게 읽기전용(ReadOnlyAccess류) 정책을 붙여야 한다(OpenRM이 강제 불가).
'use strict'
const { execFile } = require('child_process')

const run = (args, t = 20000) =>
	new Promise((resolve) => {
		execFile('aws', args, { timeout: t, maxBuffer: 4 << 20, env: process.env }, (e, out, err) => {
			resolve({ ok: !e, out: String(out || ''), err: String(err || (e && e.message) || '') })
		})
	})
const cfg = (key) => run(['configure', 'get', key], 8000).then((r) => (r.ok ? r.out.trim() : ''))

let last = { expiration: null, renewedAt: null } // 마지막 갱신 결과 (만료 카운트다운 표시용)
let probe = { at: 0, valid: false, account: '', arn: '', error: null } // get-caller-identity 캐시(과호출 방지)
const PROBE_TTL = 45000

function friendlyError(err) {
	const e = String(err || '')
	if (/ExpiredToken/i.test(e)) return '세션 만료 — MFA 코드로 갱신 필요'
	if (/MultiFactorAuthentication failed|InvalidToken|not valid for this entity|invalid MFA/i.test(e)) return 'MFA 코드가 올바르지 않거나 만료됐습니다 — 새 코드로 다시'
	if (/InvalidClientTokenId|SignatureDoesNotMatch/i.test(e)) return 'default 영구 자격증명 오류 (~/.aws/credentials 확인)'
	if (/AccessDenied/i.test(e)) return '권한 거부 — IAM 권한 확인 필요'
	if (/Unable to locate credentials|could not be found/i.test(e)) return 'default 프로필 자격증명을 찾을 수 없음'
	return (e.split('\n').find((l) => l.trim()) || 'AWS 호출 실패').slice(0, 160)
}

async function refreshProbe(force) {
	const now = Date.now()
	if (!force && now - probe.at < PROBE_TTL) return probe
	const r = await run(['sts', 'get-caller-identity', '--profile', 'mfa', '--output', 'json'], 12000)
	if (r.ok) {
		let id = {}
		try {
			id = JSON.parse(r.out)
		} catch (_) {}
		probe = { at: now, valid: true, account: id.Account || '', arn: id.Arn || '', error: null }
	} else {
		probe = { at: now, valid: false, account: '', arn: '', error: friendlyError(r.err) }
	}
	return probe
}

async function status(force) {
	const [p, serial] = await Promise.all([refreshProbe(force), cfg('default.mfa_serial')])
	const expMs = last.expiration ? Date.parse(last.expiration) : null
	const remainingMs = expMs != null && !Number.isNaN(expMs) ? Math.max(0, expMs - Date.now()) : null
	return {
		valid: p.valid,
		error: p.error,
		account: p.account,
		arn: p.arn,
		serial: serial || null,
		hasSerial: !!serial,
		expiration: last.expiration,
		remainingMs,
		renewedAt: last.renewedAt,
	}
}

async function renew(code) {
	const token = String(code || '').trim()
	if (!/^\d{6}$/.test(token)) return { ok: false, error: 'MFA 코드는 6자리 숫자여야 합니다.' }
	const serial = await cfg('default.mfa_serial')
	if (!serial) return { ok: false, error: 'default 프로필에 mfa_serial이 없습니다 (~/.aws/config).' }
	const duration = (await cfg('default.duration_seconds')) || '129600'
	const r = await run(['sts', 'get-session-token', '--serial-number', serial, '--token-code', token, '--duration-seconds', String(duration), '--profile', 'default', '--output', 'json'], 25000)
	if (!r.ok) return { ok: false, error: friendlyError(r.err) }
	let creds
	try {
		creds = JSON.parse(r.out).Credentials
	} catch (_) {
		return { ok: false, error: 'STS 응답 파싱 실패' }
	}
	if (!creds || !creds.AccessKeyId) return { ok: false, error: 'STS 응답에 자격증명이 없습니다.' }
	// [mfa] 프로필에 임시 자격증명 기록 (aws_session_token 포함 — 표준 갱신과 동일)
	const fields = [
		['aws_access_key_id', creds.AccessKeyId],
		['aws_secret_access_key', creds.SecretAccessKey],
		['aws_session_token', creds.SessionToken],
	]
	for (const [k, v] of fields) {
		const w = await run(['configure', 'set', k, v, '--profile', 'mfa'], 8000)
		if (!w.ok) return { ok: false, error: `자격증명 기록 실패 (${k}): ${friendlyError(w.err)}` }
	}
	last = { expiration: creds.Expiration || null, renewedAt: Date.now() }
	probe = { at: 0, valid: false, account: '', arn: '', error: null } // 캐시 무효화 → 즉시 재확인
	const st = await status(true)
	return { ok: true, expiration: creds.Expiration || null, valid: st.valid, arn: st.arn, account: st.account, remainingMs: st.remainingMs }
}

// ── MFA 만료 감시기 — valid가 true→false로 바뀌는 순간(=인증 풀림) 맥 데스크톱 알림 ──
let _watchPrev = null // 직전 valid 상태 (전이 감지용)
let _notifiedExpiry = null // 같은 만료건 중복 알림 방지 (expiration 값)
function notifyMac(title, body) {
	execFile('osascript', ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)} sound name "Glass"`], { timeout: 8000 }, () => {})
}
async function watchTick() {
	try {
		const s = await status(false)
		// true(또는 최초 unknown이 아닌 유효) → false 전이 = 방금 풀림
		if (_watchPrev === true && s.valid === false && _notifiedExpiry !== (s.expiration || 'x')) {
			_notifiedExpiry = s.expiration || 'x'
			notifyMac('🔓 AWS MFA 인증이 풀렸습니다', 'OpenRM 모니터 탭에서 6자리 코드로 갱신하세요.')
			console.log('[aws-watch] MFA 만료 감지 → 맥 알림 발송')
		}
		if (s.valid) _notifiedExpiry = null // 재인증되면 다음 만료 때 다시 알림
		_watchPrev = s.valid
	} catch (_) {}
}
function startExpiryWatch() {
	watchTick()
	return setInterval(watchTick, 120000) // 2분마다 확인
}

module.exports = { status, renew, startExpiryWatch }
