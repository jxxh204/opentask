// deployStatus.cjs — Monitor 페이지 'AWS·배포' 카드용 초경량 배포상태 커넥터 (Phase 5.1).
//
// aws.cjs(MFA 세션 갱신)와 무관 — 새로 씀. 스펙이 얕아 '체크'는 최소한으로:
//   AppConfig.awsDeployWebhookUrl(store/settings.cjs)이 http(s)면 짧은 타임아웃 GET으로 '도달성'만 확인.
//   미설정이면 { connected:false, configured:false } → 프론트가 "+ 연결" 미연결 카드 상태로 표시.
// 딥 AWS 연동이 아니라 nice-to-have 커넥터. (URL은 응답에 마스킹해서만 노출 — 웹훅 전체 노출 금지.)
'use strict'
const AppCfg = require('./store/settings.cjs')

function mask(u) {
	try {
		const x = new URL(u)
		return x.origin + x.pathname.replace(/[^/]/g, '•')
	} catch {
		return '(설정됨)'
	}
}

function ping(url) {
	return new Promise((resolve) => {
		let lib
		try {
			lib = url.startsWith('https') ? require('https') : require('http')
		} catch (_) {
			return resolve({ ok: false })
		}
		let done = false
		const finish = (v) => {
			if (!done) {
				done = true
				resolve(v)
			}
		}
		try {
			const req = lib.request(url, { method: 'GET', timeout: 4000 }, (res) => {
				res.resume() // 바디는 버림 — 상태만 확인
				finish({ ok: (res.statusCode || 0) < 500, status: res.statusCode || 0 })
			})
			req.on('error', () => finish({ ok: false }))
			req.on('timeout', () => {
				req.destroy()
				finish({ ok: false })
			})
			req.end()
		} catch (_) {
			finish({ ok: false })
		}
	})
}

async function status() {
	const url = AppCfg.getAppConfig().awsDeployWebhookUrl
	if (!url || !/^https?:\/\//i.test(String(url))) return { id: 'aws-deploy', label: 'AWS·배포', connected: false, configured: false }
	const reach = await ping(String(url)).catch(() => ({ ok: false }))
	return { id: 'aws-deploy', label: 'AWS·배포', connected: !!reach.ok, configured: true, url: mask(String(url)), lastStatus: reach.status || null, checkedAt: Date.now() }
}

module.exports = { status }
