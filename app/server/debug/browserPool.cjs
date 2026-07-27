// debug/browserPool.cjs — 디버깅(Debug) 페이지용 실제 Playwright 브라우저 세션 관리 (Phase 4b).
//
// ⚠️ playwright는 반드시 '함수 안에서 lazy require' — 모듈 top-level에서 require하지 않는다.
//    그래야 서버 부팅이나 다른 페이지 사용 시 Chromium 미설치여도 아무 영향이 없다(디버그 세션을
//    '실제로 생성'할 때만 playwright/Chromium이 필요해짐).
//
// 단순화(의도적, 원안의 CDP 대비):
//  - 세션당 브라우저 1개(+context 1개+page 1개) — closeSession이 브라우저를 통째로 닫아 잔여 프로세스 0 보장.
//  - 네트워크/콘솔은 Playwright 네이티브 이벤트(page.on) + 세션별 ring buffer(최근 50). 수동 CDP 아님.
'use strict'
const { randomUUID } = require('crypto')

const RING = 50
const sessions = new Map() // id → { id, url, device, taskId, branchId, browser, context, page, network:[], console:[], createdAt }

function getSession(id) {
	return sessions.get(id) || null
}
function push(arr, item) {
	arr.push(item)
	if (arr.length > RING) arr.splice(0, arr.length - RING)
	return item
}
function fmtSize(bytes) {
	if (bytes == null || bytes < 0) return '-'
	if (bytes < 1024) return bytes + 'b'
	return (bytes / 1024).toFixed(1) + 'kb'
}

// Playwright request(완료/실패) → 프론트 NetworkRow 형태로 매핑. (mswOn은 신뢰성 있게 감지 불가 → false 고정.)
function buildNetRow(request, status, sizes, ms, resp, failure) {
	const raw = request.url()
	let u = null
	try {
		u = new URL(raw)
	} catch (_) {}
	let postData = ''
	try {
		postData = request.postData() || ''
	} catch (_) {}
	const reqBytes = sizes ? (sizes.requestBodySize || 0) + (sizes.requestHeadersSize || 0) : 0
	const resBytes = sizes ? (sizes.responseBodySize || 0) + (sizes.responseHeadersSize || 0) : 0
	let headerNames = ''
	try {
		headerNames = Object.keys((resp && resp.headers()) || request.headers() || {}).slice(0, 4).join(', ')
	} catch (_) {}
	return {
		id: randomUUID(),
		method: request.method(),
		url: u ? u.pathname + u.search : raw,
		status: status || 0,
		ms: ms || 0,
		mswOn: false, // MSW 여부 감지 안 함(휴리스틱 없음) — 항상 false
		reqSize: fmtSize(reqBytes),
		resSize: fmtSize(resBytes),
		type: request.resourceType(),
		fields: [
			{ key: 'payload', label: 'PAYLOAD', value: String(postData || (u && u.search) || '(none)').slice(0, 200) },
			{ key: 'response', label: 'RESPONSE', value: failure ? 'FAILED: ' + (failure.errorText || '') : String(status || 0) },
			{ key: 'headers', label: 'HEADERS', value: headerNames || '(none)' },
			{ key: 'timing', label: 'TIMING', value: 'total ' + (ms || 0) + 'ms' },
		],
	}
}

function wireEvents(rec) {
	const page = rec.page
	page.on('console', (m) => push(rec.console, { id: randomUUID(), title: m.type(), body: String(m.text() || '').slice(0, 500) }))
	page.on('pageerror', (err) => push(rec.console, { id: randomUUID(), title: 'pageerror', body: String((err && err.message) || err).slice(0, 500) }))
	page.on('requestfinished', async (request) => {
		try {
			const resp = await request.response()
			const sizes = await request.sizes().catch(() => null)
			const timing = request.timing()
			const ms = timing && timing.responseEnd > 0 ? Math.round(timing.responseEnd) : 0
			push(rec.network, buildNetRow(request, resp ? resp.status() : 0, sizes, ms, resp, null))
		} catch (_) {}
	})
	page.on('requestfailed', (request) => {
		try {
			push(rec.network, buildNetRow(request, 0, null, 0, null, request.failure()))
		} catch (_) {}
	})
}

async function createSession({ url, device, taskId, branchId } = {}) {
	if (!url) return { ok: false, error: 'url 필수' }
	let chromium
	try {
		chromium = require('playwright').chromium // ← lazy require (여기서 처음 로드)
	} catch (e) {
		return { ok: false, error: 'playwright 모듈 로드 실패: ' + String((e && e.message) || e) }
	}
	let browser
	try {
		browser = await chromium.launch({ headless: true })
	} catch (e) {
		const msg = String((e && e.message) || e)
		// Chromium 바이너리 미다운로드 시의 대표 에러를 잡아 '설치 안내'로 degrade (요청/서버 크래시 방지).
		if (/Executable doesn't exist|playwright install|please run the following command/i.test(msg)) {
			return { ok: false, error: 'Chromium이 설치되지 않았습니다. 터미널에서 npx playwright install chromium 실행 후 다시 시도하세요.' }
		}
		return { ok: false, error: '브라우저 실행 실패: ' + msg }
	}
	const id = randomUUID()
	const ctxOpts = device === 'webview' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } }
	let context, page
	try {
		context = await browser.newContext(ctxOpts)
		page = await context.newPage()
	} catch (e) {
		await browser.close().catch(() => {})
		return { ok: false, error: 'context/page 생성 실패: ' + String((e && e.message) || e) }
	}
	const rec = { id, url, device: device || 'pc', taskId: taskId || null, branchId: branchId || null, browser, context, page, network: [], console: [], createdAt: Date.now() }
	wireEvents(rec)
	sessions.set(id, rec)
	try {
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
	} catch (e) {
		// 네비게이션 실패해도 세션은 유지(사용자가 URL 고칠 수 있게) — 콘솔에 에러만 남긴다.
		push(rec.console, { id: randomUUID(), title: 'error', body: 'goto 실패: ' + String((e && e.message) || e) })
	}
	return { ok: true, id, url, device: rec.device, taskId: rec.taskId, branchId: rec.branchId }
}

async function screenshot(id) {
	const rec = sessions.get(id)
	if (!rec) return { ok: false, error: 'session not found' }
	try {
		// CDP Page.startScreencast 대신 단순 폴링용 스냅샷(의도적 단순화 — 프론트가 ~0.5~1s 폴링).
		const buffer = await rec.page.screenshot({ type: 'jpeg', quality: 60 })
		return { ok: true, buffer }
	} catch (e) {
		return { ok: false, error: String((e && e.message) || e) }
	}
}

async function closeSession(id) {
	const rec = sessions.get(id)
	if (!rec) return { ok: true, alreadyGone: true }
	sessions.delete(id)
	try {
		await rec.context.close().catch(() => {})
	} catch (_) {}
	try {
		await rec.browser.close().catch(() => {})
	} catch (_) {}
	return { ok: true, closed: id }
}

module.exports = { createSession, closeSession, screenshot, getSession, sessions }
