// debug/browserPool.cjs — 지휘자(conductor) 전용 headless Playwright 브라우저 세션 관리
// (§mcpDispatch.cjs browser_* 툴 — "태스크 매니저가 앱 내부 브라우저도 자유자재로 이용").
//
// 원래는 사람이 보는 "브라우저" 탭도 이 Playwright 세션을 스크린샷 폴링으로 보여줬지만, 그 방식은
// 로그인 세션이 없고(매번 새 쿠키) 화면 비율도 안 맞아 사람이 보는 화면은 Electron 네이티브 <webview>로
// 교체했다(§BrowserPane.tsx). 이 파일은 이제 지휘자가 텍스트로 웹을 읽고 조작하는 headless 자동화
// 전용이다 — 스크린샷·네트워크·콘솔 캡처처럼 화면 표시용이었던 기능은 더 이상 필요 없어 들어냈다.
//
// ⚠️ playwright는 반드시 '함수 안에서 lazy require' — 모듈 top-level에서 require하지 않는다.
//    그래야 서버 부팅 시 Chromium 미설치여도 아무 영향이 없다(세션을 '실제로 생성'할 때만 필요해짐).
// 단순화: 세션당 브라우저 1개(+context 1개+page 1개) — closeSession이 통째로 닫아 잔여 프로세스 0 보장.
'use strict'
const { randomUUID } = require('crypto')

const sessions = new Map() // id → { id, url, device, taskId, branchId, browser, context, page, createdAt }

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
	const rec = { id, url, device: device || 'pc', taskId: taskId || null, branchId: branchId || null, browser, context, page, createdAt: Date.now() }
	sessions.set(id, rec)
	try {
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
	} catch (e) {
		// 네비게이션 실패해도 세션은 유지(URL을 고쳐 다시 시도할 수 있게) — 에러만 돌려준다.
		return { ok: true, id, url, device: rec.device, taskId: rec.taskId, branchId: rec.branchId, navigateError: String((e && e.message) || e) }
	}
	return { ok: true, id, url, device: rec.device, taskId: rec.taskId, branchId: rec.branchId }
}

// ── 지휘자용 실조작 — navigate/click/type이 실제로 페이지를 바꾸고, readText로 화면 대신 텍스트를 읽는다.
async function navigate(id, url) {
	const rec = sessions.get(id)
	if (!rec) return { ok: false, error: 'session not found' }
	if (!url) return { ok: false, error: 'url 필수' }
	try {
		await rec.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
		rec.url = url
		return { ok: true, url }
	} catch (e) {
		return { ok: false, error: 'goto 실패: ' + String((e && e.message) || e) }
	}
}

async function click(id, selector) {
	const rec = sessions.get(id)
	if (!rec) return { ok: false, error: 'session not found' }
	if (!selector) return { ok: false, error: 'selector 필수' }
	try {
		await rec.page.click(selector, { timeout: 5000 })
		return { ok: true }
	} catch (e) {
		return { ok: false, error: 'click 실패: ' + String((e && e.message) || e) }
	}
}

async function type(id, selector, text, submit) {
	const rec = sessions.get(id)
	if (!rec) return { ok: false, error: 'session not found' }
	if (!selector) return { ok: false, error: 'selector 필수' }
	try {
		await rec.page.fill(selector, text || '')
		if (submit) await rec.page.press(selector, 'Enter')
		return { ok: true }
	} catch (e) {
		return { ok: false, error: 'type 실패: ' + String((e && e.message) || e) }
	}
}

// 지휘자는 스크린샷을 "보지" 못하니(텍스트 전용 CLI 에이전트) 화면 대신 읽을 텍스트를 돌려준다.
async function readText(id) {
	const rec = sessions.get(id)
	if (!rec) return { ok: false, error: 'session not found' }
	try {
		const [title, text] = await Promise.all([
			rec.page.title().catch(() => ''),
			rec.page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => ''),
		])
		return { ok: true, url: rec.page.url(), title, text: String(text || '').slice(0, 8000) }
	} catch (e) {
		return { ok: false, error: 'read 실패: ' + String((e && e.message) || e) }
	}
}

// 이 taskId(=폴더/노드 id)로 이미 열려 있는 세션 중 가장 최근 것 — mcpDispatch.cjs의 browser_open이
// 지휘자 세션 재시작(--continue) 후에도 새 Chromium을 또 띄우지 않고 기존 세션을 재사용하는 용도.
function findActiveByTaskId(taskId) {
	if (!taskId) return null
	let best = null
	for (const rec of sessions.values()) {
		if (rec.taskId === taskId && (!best || rec.createdAt > best.createdAt)) best = rec
	}
	if (!best) return null
	return { id: best.id, url: best.url, device: best.device, taskId: best.taskId, branchId: best.branchId, createdAt: best.createdAt }
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

module.exports = { createSession, closeSession, navigate, click, type, readText, findActiveByTaskId }
