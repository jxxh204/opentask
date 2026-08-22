// githubConnect.cjs — GitHub를 "버튼 한 번"으로 연동하는 두 가지 방법.
//   ① gh CLI 위임(ghStatus) — 로컬에 이미 `gh auth login`돼 있으면 그 세션을 그대로 씀. 설정 0.
//   ② OAuth Device Flow(start/poll) — gh CLI가 없거나 다른 계정으로 붙이고 싶을 때. 로컬 앱이라
//      포트가 매번 바뀌어 표준 콜백 URL이 필요한 Authorization Code Flow 대신, gh CLI와 동일한 방식인
//      Device Flow를 쓴다. Device Flow는 client_secret이 필요 없다(공개 클라이언트) — Client ID만 있으면 됨.
'use strict'
const https = require('https')
const { execFile } = require('child_process')
const AppCfg = require('./store/settings.cjs')
const Secrets = require('./store/secrets.cjs')
const { ghEnv } = require('./ghEnv.cjs')

function httpsJson(path, payload) {
	return new Promise((resolve) => {
		const body = JSON.stringify(payload)
		const req = https.request(
			{ host: 'github.com', port: 443, method: 'POST', path, headers: { 'content-type': 'application/json', accept: 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 15000 },
			(res) => {
				const chunks = []
				res.on('data', (c) => chunks.push(c))
				res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
			},
		)
		req.on('timeout', () => {
			req.destroy()
			resolve({ status: 0, error: '요청 타임아웃' })
		})
		req.on('error', (e) => resolve({ status: 0, error: String(e.message || e) }))
		req.write(body)
		req.end()
	})
}

// ── ① gh CLI 위임 ──
function ghStatus() {
	return new Promise((resolve) => {
		execFile('gh', ['api', 'user', '--jq', '.login'], { timeout: 10000, env: ghEnv() }, (e, out) => {
			const login = String(out || '').trim()
			resolve(e || !login ? { ok: true, loggedIn: false } : { ok: true, loggedIn: true, username: login })
		})
	})
}

// ── ② OAuth Device Flow ──
let pending = null // { deviceCode, clientId, expiresAt } — 단일 오퍼레이터 로컬 앱이라 전역 상태로 충분

async function oauthStart() {
	const clientId = AppCfg.getAppConfig().githubOAuthClientId
	if (!clientId) return { ok: false, error: 'GitHub OAuth App Client ID가 설정되지 않았습니다.' }
	const r = await httpsJson('/login/device/code', { client_id: clientId, scope: 'repo' })
	if (r.error || r.status !== 200) return { ok: false, error: r.error || `GitHub 응답 오류 (${r.status})` }
	let data
	try {
		data = JSON.parse(r.body)
	} catch (_) {
		return { ok: false, error: '응답 파싱 실패' }
	}
	if (!data.device_code) return { ok: false, error: data.error_description || 'device_code 발급 실패' }
	pending = { deviceCode: data.device_code, clientId, expiresAt: Date.now() + data.expires_in * 1000 }
	return { ok: true, userCode: data.user_code, verificationUri: data.verification_uri, interval: data.interval || 5, expiresIn: data.expires_in }
}

async function oauthPoll() {
	if (!pending) return { ok: false, error: '먼저 연동을 시작하세요.' }
	if (Date.now() > pending.expiresAt) {
		pending = null
		return { ok: false, error: '코드가 만료됐습니다 — 다시 시도하세요.' }
	}
	const r = await httpsJson('/login/oauth/access_token', { client_id: pending.clientId, device_code: pending.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
	if (r.error || r.status !== 200) return { ok: false, error: r.error || `GitHub 응답 오류 (${r.status})` }
	let data
	try {
		data = JSON.parse(r.body)
	} catch (_) {
		return { ok: false, error: '응답 파싱 실패' }
	}
	if (data.error === 'authorization_pending') return { ok: true, done: false }
	if (data.error === 'slow_down') return { ok: true, done: false, slowDown: true }
	if (data.error) {
		pending = null
		return { ok: false, error: data.error_description || data.error }
	}
	if (!data.access_token) return { ok: false, error: '토큰 발급 실패' }
	Secrets.set('githubToken', data.access_token)
	pending = null
	const who = await new Promise((resolve) => {
		const req = https.request({ host: 'api.github.com', port: 443, method: 'GET', path: '/user', headers: { 'user-agent': 'openrm', accept: 'application/json', authorization: `Bearer ${data.access_token}` }, timeout: 10000 }, (res) => {
			const chunks = []
			res.on('data', (c) => chunks.push(c))
			res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
		})
		req.on('timeout', () => {
			req.destroy()
			resolve('')
		})
		req.on('error', () => resolve(''))
		req.end()
	})
	let username = null
	try {
		username = JSON.parse(who).login || null
	} catch (_) {}
	return { ok: true, done: true, username }
}

module.exports = { ghStatus, oauthStart, oauthPoll }
