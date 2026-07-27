// notiontitles.cjs — 노션 카드 제목 캐시. 백엔드엔 Notion 토큰이 없어 URL만으론 제목을 못 얻으므로,
// (1) URL 슬러그에서 제목 추출(가능한 경우) (2) 외부(에이전트/이 세션)가 채워주는 캐시를 병행.
// build 출력에 pageId→title 맵(notionMeta)을 붙여 프론트가 "노션 카드" 대신 실제 제목/백로그로 표시.
'use strict'
const fs = require('fs')
const path = require('path')
const FILE = process.env.OPENRM_NOTION_TITLES || path.join(__dirname, '..', '.openrm-notion-titles.json')

function load() {
	try {
		return JSON.parse(fs.readFileSync(FILE, 'utf8'))
	} catch {
		return {}
	}
}
function save(m) {
	try {
		fs.writeFileSync(FILE, JSON.stringify(m))
	} catch (_) {}
}
// 노션 URL에서 32자리 페이지 ID 추출 (슬러그 뒤 마지막 hex 덩어리)
function pageId(url) {
	const m = String(url || '').match(/[0-9a-f]{32}/gi)
	return m ? m[m.length - 1].toLowerCase() : null
}
// URL 슬러그에서 제목 추정: /Some-Title-<32hex> → "Some Title"
function slugTitle(url) {
	try {
		const seg = decodeURIComponent(String(url).split(/[?#]/)[0].split('/').pop() || '')
		const m = seg.match(/^(.+?)-?([0-9a-f]{32})$/i)
		if (m && m[1] && !/^[0-9a-f-]+$/i.test(m[1])) return m[1].replace(/-/g, ' ').trim()
	} catch (_) {}
	return null
}
function setTitle(id, title, backlog) {
	const key = String(id || '').toLowerCase()
	if (!key || !/^[0-9a-f]{32}$/.test(key)) return { ok: false, error: 'pageId(32 hex) 필요' }
	const m = load()
	const t = String(title || '').trim().slice(0, 140)
	if (t) m[key] = { title: t, backlog: !!backlog, at: Date.now() }
	else delete m[key]
	save(m)
	return { ok: true, id: key, title: t || null, backlog: !!backlog }
}
function getTitle(id) {
	const e = load()[String(id || '').toLowerCase()]
	return e ? e.title : null
}
// build 결과의 notion URL들에 대해 pageId→{t:제목, b:백로그여부} 맵 (캐시 우선, 없으면 슬러그)
function metaFor(tasks) {
	const cache = load()
	const out = {}
	for (const t of tasks || []) {
		for (const u of ((t.links || {}).notion || [])) {
			const id = pageId(u)
			if (!id || out[id]) continue
			if (cache[id]) out[id] = { t: cache[id].title, b: !!cache[id].backlog }
			else {
				const s = slugTitle(u)
				if (s) out[id] = { t: s, b: false }
			}
		}
	}
	return out
}
// 캐시에 아직 제목 없는(슬러그도 없는) 노션 pageId 목록 — 리졸버가 채울 대상
function unknownIds(tasks) {
	const cache = load()
	const ids = new Set()
	for (const t of tasks || []) {
		for (const u of ((t.links || {}).notion || [])) {
			const id = pageId(u)
			if (id && !cache[id] && !slugTitle(u)) ids.add(id)
		}
	}
	return [...ids]
}

module.exports = { pageId, slugTitle, setTitle, getTitle, metaFor, unknownIds }
