// figma.cjs — backlog의 figmaNodes ↔ 현재 구현(Storybook)을 나란히 비교하기 위해
// Figma 노드 이미지를 REST(/v1/images)로 가져온다. 토큰 없으면 딥링크로 degrade.
// MCP는 서버에서 호출 불가(에이전트 도구)라 REST가 유일한 런타임 경로. 의존성 0.
'use strict'
const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const C = require('./collector.cjs')

// 로컬 Figma Dev Mode MCP 서버 (무제한·라이브). 데스크톱 Figma가 켜져 있으면 3845에서 LISTEN.
const MCP_HOST = process.env.FIGMA_MCP_HOST || '127.0.0.1'
const MCP_PORT = Number(process.env.FIGMA_MCP_PORT) || 3845

const TOKEN = process.env.FIGMA_TOKEN || ''
const FALLBACK_KEY = 'xvZ03MYUqSA6jkYxVjZMfm' // state.json.bak 기준 기본 파일키

function fileKey() {
	if (process.env.FIGMA_FILE_KEY) return process.env.FIGMA_FILE_KEY
	try {
		const raw = JSON.parse(fs.readFileSync(C.STATE_PATH, 'utf8'))
		return raw.figmaFileKey || (raw.epic && raw.epic.figmaFileKey) || FALLBACK_KEY
	} catch {
		return FALLBACK_KEY
	}
}

// 피처 백로그에 박힌 figmaNodes 목록 (중복 제거 + 백로그 라벨)
function nodes() {
	let model
	try {
		model = C.readModel()
	} catch {
		model = {}
	}
	const lanes = model.backlogs || {}
	const seen = new Set()
	const out = []
	for (const lane of Object.values(lanes))
		for (const b of lane)
			for (const n of b.figmaNodes || []) {
				if (seen.has(n)) continue
				seen.add(n)
				out.push({ node: n, backlog: b.id, title: b.title || null })
			}
	return { fileKey: fileKey(), hasToken: !!TOKEN, nodes: out }
}

function getJSON(url, headers) {
	return new Promise((resolve, reject) => {
		https
			.get(url, { headers }, (res) => {
				let body = ''
				res.on('data', (d) => (body += d))
				res.on('end', () => {
					try {
						resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(body) })
					} catch {
						resolve({ status: res.statusCode, headers: res.headers, json: null })
					}
				})
			})
			.on('error', reject)
	})
}

// ── 로컬 Dev Mode MCP 클라이언트 (Streamable HTTP) — get_screenshot로 PNG 받기. 무제한·라이브 ──
function mcpPost(payload, sid) {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(payload)
		const req = http.request(
			{
				host: MCP_HOST,
				port: MCP_PORT,
				path: '/mcp',
				method: 'POST',
				timeout: 20000,
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
					'MCP-Protocol-Version': '2025-06-18',
					'Content-Length': Buffer.byteLength(data),
					...(sid ? { 'mcp-session-id': sid } : {}),
				},
			},
			(res) => {
				let b = ''
				res.on('data', (d) => (b += d))
				res.on('end', () => resolve({ headers: res.headers, body: b }))
			},
		)
		req.on('error', reject)
		req.on('timeout', () => req.destroy(new Error('mcp timeout')))
		req.write(data)
		req.end()
	})
}
function parseSSE(body) {
	for (const line of body.split('\n')) {
		if (line.startsWith('data:')) {
			try {
				const j = JSON.parse(line.slice(5).trim())
				if (j.result || j.error) return j
			} catch {
				/* keep scanning */
			}
		}
	}
	return null
}
let mcpDownUntil = 0 // Figma 데스크톱 꺼짐 등으로 실패하면 잠깐 백오프
async function mcpSession() {
	if (Date.now() < mcpDownUntil) return null
	try {
		const r = await mcpPost({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'openrm', version: '1' } },
		})
		const sid = r.headers['mcp-session-id']
		if (!sid) {
			mcpDownUntil = Date.now() + 60000
			return null
		}
		await mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid)
		return sid
	} catch {
		mcpDownUntil = Date.now() + 60000
		return null
	}
}
async function mcpScreenshot(sid, nodeId, fileKey) {
	const r = await mcpPost(
		{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_screenshot', arguments: { nodeId, fileKey, maxDimension: 2048 } } },
		sid,
	)
	const j = parseSSE(r.body)
	const img = j && j.result && (j.result.content || []).find((c) => c.type === 'image')
	return img && img.data ? Buffer.from(img.data, 'base64') : null
}

// figmaNodes(대시 "2191-43294") → REST ids(콜론 "2191:43294"). 응답도 콜론 키라 되돌려 매핑.
const toColon = (id) => id.replace('-', ':')
const deepLink = (key, id) => `https://www.figma.com/file/${key}?node-id=${encodeURIComponent(id)}`

// MCP로 미리 받아둔 PNG 영구 저장소 (REST 페이월 우회). 있으면 이걸 최우선 제공 → 토큰/만료 무관.
const IMG_DIR = path.join(os.tmpdir(), 'openrm-figma-img')
const safeName = (id) => id.replace(/[^\w.-]/g, '_')
const localPath = (id) => path.join(IMG_DIR, safeName(id) + '.png')
function hasLocal(id) {
	try {
		return fs.statSync(localPath(id)).size > 0
	} catch {
		return false
	}
}
function imageFile(id) {
	return hasLocal(id) ? localPath(id) : null
}

// 디스크 영속 캐시(노드ID→{at,url}) + rate-limit 쿨다운. 재시작·반복 조회에도 Figma 호출 최소화.
const CACHE_FILE = path.join(os.tmpdir(), 'openrm-figma-cache.json')
const CACHE_TTL = 6 * 3600 * 1000 // 6시간 (이미지 URL 만료 전 재사용)
let cache = {}
try {
	cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {}
} catch {
	cache = {}
}
let cooldownUntil = 0 // rate-limit 시 이 시각까지 API 호출 안 함
function saveCache() {
	try {
		fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
	} catch {
		/* best-effort */
	}
}

async function images(nodeIds) {
	const key = fileKey()
	const links = Object.fromEntries(nodeIds.map((id) => [id, deepLink(key, id)]))
	const now = Date.now()

	// 1) 로컬 PNG(이전에 받아둔 것) 최우선 → REST URL 캐시 → 나머지는 새로 받아야
	const out = {}
	const need = []
	for (const id of nodeIds) {
		if (hasLocal(id)) out[id] = `/api/figma/img?node=${encodeURIComponent(id)}`
		else if (cache[id] && now - cache[id].at < CACHE_TTL) out[id] = cache[id].url
		else need.push(id)
	}
	if (!need.length) return { ok: true, fileKey: key, images: out, links, cached: true }

	// 2) 로컬 Dev Mode MCP(무제한·라이브) 우선 — 받은 PNG는 영구 저장. 토큰 불필요.
	const sid = await mcpSession()
	if (sid) {
		try {
			fs.mkdirSync(IMG_DIR, { recursive: true })
		} catch {
			/* ignore */
		}
		for (const id of need) {
			try {
				const buf = await mcpScreenshot(sid, id, key)
				if (buf && buf.length > 100) {
					fs.writeFileSync(localPath(id), buf)
					out[id] = `/api/figma/img?node=${encodeURIComponent(id)}`
				}
			} catch {
				/* 이 노드는 REST 폴백 */
			}
		}
	}
	const left = need.filter((id) => !out[id])
	if (!left.length) return { ok: true, fileKey: key, images: out, links, source: 'mcp' }

	// 3) REST 폴백 (MCP 미가동/실패분). 토큰 없거나 쿨다운/페이월이면 null → 프론트는 딥링크.
	if (!TOKEN) return { ok: false, reason: 'no-token', fileKey: key, images: out, links }
	if (now < cooldownUntil)
		return { ok: false, reason: 'rate-limit', retryInMs: cooldownUntil - now, fileKey: key, images: out, links }
	try {
		const r = await getJSON(
			`https://api.figma.com/v1/images/${key}?ids=${encodeURIComponent(left.map(toColon).join(','))}&format=png&scale=2`,
			{ 'X-Figma-Token': TOKEN },
		)
		const rateLimited =
			r.status === 429 || (r.json && (r.json.status === 429 || /rate limit/i.test(String(r.json.err || ''))))
		if (rateLimited) {
			const retryAfterSec = Math.min(Number(r.headers && r.headers['retry-after']) || 90, 7 * 24 * 3600)
			cooldownUntil = now + retryAfterSec * 1000
			return { ok: false, reason: 'rate-limit', retryInMs: retryAfterSec * 1000, fileKey: key, images: out, links }
		}
		if (!r.json) return { ok: false, reason: `HTTP ${r.status}`, fileKey: key, images: out, links }
		if (r.json.err) return { ok: false, reason: String(r.json.err), fileKey: key, images: out, links }
		for (const id of left) {
			const url = r.json.images[toColon(id)] || null
			out[id] = url
			if (url) cache[id] = { at: now, url }
		}
		saveCache()
		return { ok: true, fileKey: key, images: out, links }
	} catch (e) {
		return { ok: false, reason: String(e.message || e), fileKey: key, images: out, links }
	}
}

module.exports = { images, nodes, fileKey, imageFile, hasToken: () => !!TOKEN }
