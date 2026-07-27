// architecture.cjs — 아키텍처 페이지 백엔드 (Phase 5b). 전부 read-only.
//   DB : pg introspection (information_schema / pg_proc) — SELECT만, 절대 write/migrate 안 함.
//   API: apiRoot 도메인 폴더를 정규식 스캔(apiusage.cjs 기법) → 코드에서 참조하는 실제 테이블/함수명만 교차검증.
//   NEXT: nextRoot 페이지/라우트 파일 → import 1~2홉(graph.cjs resolveSpec 기법) 따라 touch하는 api 도메인 도출.
// 결과는 architecture_cache 테이블(db/api/routes 3행)에 캐시. graph()가 조립해 프론트 ArchGraph 계약과 정확히 일치시킴.
//
// DB 그룹핑: '테이블명 prefix(첫 _ 앞)' 그룹핑을 택함. FK-connected-component가 아님 —
//   FK 그룹핑은 허브 테이블(users 등)로 전체가 한 덩어리로 붕괴하기 쉬워 임의 스키마에 취약. prefix는 결정론적·안정적.
// pg는 dbConnect 안에서 lazy require — 미설치여도 config/graph/스캔은 동작.
'use strict'
const fs = require('fs')
const path = require('path')
const C = require('./collector.cjs')
const AppCfg = require('./store/settings.cjs')
const Secrets = require('./store/secrets.cjs')
const { db } = require('./db.cjs')

const EXTS = ['.ts', '.tsx', '.js', '.jsx']
const IMPORT_RE_SRC = `(?:import|export)[\\s\\S]*?from\\s*['"]([^'"]+)['"]|require\\(\\s*['"]([^'"]+)['"]\\s*\\)`
const SRC = () => path.join(C.REPO, 'src')
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ── 공통 파일 워크 (apiusage.cjs/graph.cjs와 동일 기법) ──
function walk(dir, out = []) {
	let ents
	try {
		ents = fs.readdirSync(dir, { withFileTypes: true })
	} catch {
		return out
	}
	for (const e of ents) {
		if (e.name === 'node_modules' || e.name.startsWith('.')) continue
		const p = path.join(dir, e.name)
		if (e.isDirectory()) walk(p, out)
		else if (EXTS.includes(path.extname(e.name)) && !/\.(test|spec|stories)\./.test(e.name)) out.push(p)
	}
	return out
}
// import 스펙 → 실제 파일 경로 (상대 + '@/' 별칭) — graph.cjs resolveSpec 이식.
function resolveSpec(spec, fromFile) {
	let base
	if (spec.startsWith('@/')) base = path.join(SRC(), spec.slice(2))
	else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
	else return null
	const cands = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(base, 'index' + e))]
	for (const c of cands) {
		try {
			if (fs.statSync(c).isFile()) return c
		} catch {}
	}
	return null
}

// ── 캐시 (architecture_cache: layer PK) ──
function saveLayer(layer, data) {
	db.prepare('INSERT INTO architecture_cache (layer, data_json, scanned_at) VALUES (?, ?, ?) ON CONFLICT(layer) DO UPDATE SET data_json = excluded.data_json, scanned_at = excluded.scanned_at').run(layer, JSON.stringify(data), Date.now())
}
function loadLayer(layer) {
	const r = db.prepare('SELECT data_json, scanned_at FROM architecture_cache WHERE layer = ?').get(layer)
	if (!r) return null
	try {
		return { data: JSON.parse(r.data_json), scannedAt: r.scanned_at }
	} catch {
		return null
	}
}

// ── config ──
function maskUrl(u) {
	try {
		const x = new URL(u)
		return `${x.protocol}//${x.username ? '•••@' : ''}${x.host}${x.pathname}`
	} catch {
		return '(설정됨)'
	}
}
function config() {
	const cfg = AppCfg.getAppConfig()
	const dbUrl = Secrets.get('dbConnString')
	return {
		ok: true,
		db: { connected: !!dbUrl, url: dbUrl ? maskUrl(dbUrl) : null, schema: cfg.dbSchema || 'public' },
		api: { connected: !!cfg.apiRoot, root: cfg.apiRoot || null, base: cfg.apiBaseUrl || null },
		next: { connected: !!cfg.nextRoot, root: cfg.nextRoot || null, port: cfg.nextPort || null, router: cfg.nextRouterMode || 'app' },
		layers: { db: !!dbUrl, api: !!cfg.apiRoot, next: !!cfg.nextRoot },
	}
}

// ── DB introspection (read-only) ──
async function introspect(client, schema) {
	const tablesRes = await client.query(
		`SELECT t.table_name AS name,
		        (SELECT count(*) FROM information_schema.columns c WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name) AS cols
		   FROM information_schema.tables t
		  WHERE t.table_schema = $1 AND t.table_type = 'BASE TABLE'
		  ORDER BY t.table_name`,
		[schema],
	)
	const tables = tablesRes.rows.map((r) => ({ name: r.name, cols: Number(r.cols) || 0 }))
	const fnRes = await client.query(
		`SELECT p.proname AS name, pg_get_function_result(p.oid) AS result
		   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
		  WHERE n.nspname = $1 AND p.prokind IN ('f', 'p')
		  ORDER BY p.proname`,
		[schema],
	)
	const functions = fnRes.rows.map((r) => ({ name: r.name, result: r.result }))
	return { tables, functions }
}

// pure transform (테스트 가능) — introspection → dbGroups(프론트 계약) + dbNames(교차검증용).
const prefixOf = (name) => {
	const i = String(name).indexOf('_')
	return i > 0 ? String(name).slice(0, i) : String(name)
}
function buildDbGraph({ tables, functions }) {
	const groups = new Map() // `${kind}:${prefix}` → { label, kind, nodes[] }
	const addNode = (kind, name, meta) => {
		const key = kind + ':' + prefixOf(name)
		if (!groups.has(key)) groups.set(key, { label: prefixOf(name).toUpperCase(), kind, nodes: [] })
		groups.get(key).nodes.push({ id: name, kind, name, ko: '', meta }) // id = bare name (fixture와 동일 → 재스캔 안정)
	}
	for (const t of tables) addNode('table', t.name, `${t.cols}개 컬럼`)
	for (const f of functions) addNode('fn', f.name, f.result ? `returns ${f.result}` : 'function')
	const dbGroups = [...groups.values()].sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'table' ? -1 : 1))
	const dbNames = [...tables.map((t) => t.name), ...functions.map((f) => f.name)]
	return { dbGroups, dbNames }
}

async function dbConnect({ url, schema } = {}) {
	const connStr = (url && String(url).trim()) || Secrets.get('dbConnString')
	if (!connStr) return { ok: false, error: 'DB 연결 문자열이 없습니다.' }
	const sch = (schema && String(schema).trim()) || AppCfg.getAppConfig().dbSchema || 'public'
	let Client
	try {
		Client = require('pg').Client // ← lazy require
	} catch (e) {
		return { ok: false, error: 'pg 모듈 로드 실패 (npm i pg 필요): ' + String((e && e.message) || e) }
	}
	const client = new Client({ connectionString: connStr, statement_timeout: 8000, query_timeout: 8000, connectionTimeoutMillis: 6000 })
	try {
		await client.connect()
	} catch (e) {
		try {
			await client.end()
		} catch {}
		return { ok: false, error: 'DB 연결 실패: ' + String((e && e.message) || e).split('\n')[0].slice(0, 240) }
	}
	try {
		const data = await introspect(client, sch) // read-only
		const g = buildDbGraph(data)
		// 연결·introspection이 성공했을 때만 Setup과 동일 경로로 영속화 (실패 시 기존 설정 보존 — 좋은 URL을 나쁜 URL로 덮지 않게).
		if (url && String(url).trim()) Secrets.set('dbConnString', String(url).trim())
		AppCfg.updateAppConfig({ dbSchema: sch })
		saveLayer('db', { dbGroups: g.dbGroups, dbNames: g.dbNames, schema: sch, tables: data.tables.length, functions: data.functions.length })
		return { ok: true, schema: sch, tables: data.tables.length, functions: data.functions.length, dbGroups: g.dbGroups.length }
	} catch (e) {
		return { ok: false, error: 'introspection 실패: ' + String((e && e.message) || e).slice(0, 240) }
	} finally {
		try {
			await client.end()
		} catch {}
	}
}

// ── API 스캔 ──
async function apiScan({ root, base } = {}) {
	const cfg = AppCfg.getAppConfig()
	const apiRoot = (root && String(root).trim()) || cfg.apiRoot
	if (!apiRoot) return { ok: false, error: 'apiRoot가 설정되지 않았습니다.' }
	const absRoot = path.isAbsolute(apiRoot) ? apiRoot : path.join(C.REPO, apiRoot)
	let domains
	try {
		domains = fs.readdirSync(absRoot, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort()
	} catch (e) {
		return { ok: false, error: 'apiRoot 읽기 실패: ' + absRoot }
	}
	// 루트 읽기 성공 후에만 영속화 (Setup과 동일 경로)
	if (root && String(root).trim()) AppCfg.updateAppConfig({ apiRoot: String(root).trim() })
	if (base && String(base).trim()) AppCfg.updateAppConfig({ apiBaseUrl: String(base).trim() })
	// db 레이어의 실제 테이블/함수명 (교차검증 → 오탐 차단). 없으면 refs 못 채움(추측 안 함).
	const dbLayer = loadLayer('db')
	const known = ((dbLayer && dbLayer.data && dbLayer.data.dbNames) || []).filter(Boolean)
	const combined = known.length ? new RegExp('\\b(' + known.map(escapeRe).join('|') + ')\\b', 'g') : null
	const apiNodes = []
	for (const domain of domains) {
		const refs = new Set()
		if (combined) {
			for (const f of walk(path.join(absRoot, domain))) {
				let c = ''
				try {
					c = fs.readFileSync(f, 'utf8')
				} catch {
					continue
				}
				combined.lastIndex = 0
				let m
				while ((m = combined.exec(c))) refs.add(m[1])
			}
		}
		apiNodes.push({ id: 'a:' + domain, name: domain, dbRefs: [...refs].sort() })
	}
	saveLayer('api', { apiNodes, root: apiRoot })
	return { ok: true, domains: domains.length, apiNodes: apiNodes.length, crossCheckedAgainst: known.length, dbConnected: !!combined }
}

// ── Next 스캔 ──
function toRoutePath(file, absRoot, router) {
	let rel = path.relative(absRoot, file).replace(/\\/g, '/')
	if (router === 'app') rel = rel.replace(/(^|\/)(page|route)\.(t|j)sx?$/, '')
	else rel = rel.replace(/\.(t|j)sx?$/, '').replace(/(^|\/)index$/, '$1')
	rel = rel.replace(/\([^/]+\)\//g, '') // app router route groups
	rel = ('/' + rel).replace(/\/+/g, '/')
	if (rel.length > 1) rel = rel.replace(/\/$/, '')
	return rel || '/'
}
function followImportsToDomains(startFile, apiRootAbs, apiDomains, maxHops = 2) {
	const found = new Set()
	const seen = new Set()
	let frontier = [startFile]
	for (let hop = 0; hop <= maxHops && frontier.length; hop++) {
		const next = []
		for (const file of frontier) {
			if (seen.has(file)) continue
			seen.add(file)
			let c = ''
			try {
				c = fs.readFileSync(file, 'utf8')
			} catch {
				continue
			}
			const re = new RegExp(IMPORT_RE_SRC, 'g')
			let m
			while ((m = re.exec(c))) {
				const spec = m[1] || m[2]
				if (!spec) continue
				const resolved = resolveSpec(spec, file)
				if (!resolved) continue
				if (resolved === apiRootAbs || resolved.startsWith(apiRootAbs + path.sep)) {
					const domain = path.relative(apiRootAbs, resolved).split(path.sep)[0]
					if (domain && (!apiDomains.size || apiDomains.has(domain))) found.add(domain)
				}
				if (resolved.startsWith(SRC() + path.sep)) next.push(resolved) // 다음 홉으로 프로젝트 내부 파일만
			}
		}
		frontier = next
	}
	return found
}
async function nextScan({ root, port, router } = {}) {
	const cfg = AppCfg.getAppConfig()
	const nextRoot = (root && String(root).trim()) || cfg.nextRoot
	const routerMode = (router && String(router).trim()) || cfg.nextRouterMode || 'app'
	if (!nextRoot) return { ok: false, error: 'nextRoot가 설정되지 않았습니다.' }
	const absRoot = path.isAbsolute(nextRoot) ? nextRoot : path.join(C.REPO, nextRoot)
	try {
		if (!fs.statSync(absRoot).isDirectory()) throw 0
	} catch {
		return { ok: false, error: 'nextRoot 읽기 실패: ' + absRoot }
	}
	// 루트 확인 후에만 영속화 (Setup과 동일 경로)
	if (root && String(root).trim()) AppCfg.updateAppConfig({ nextRoot: String(root).trim() })
	if (port != null && String(port).trim()) AppCfg.updateAppConfig({ nextPort: Number(port) || null })
	if (router && String(router).trim()) AppCfg.updateAppConfig({ nextRouterMode: routerMode })
	const apiRootAbs = path.join(C.REPO, cfg.apiRoot || 'src/features')
	const apiLayer = loadLayer('api')
	const apiDomains = new Set(((apiLayer && apiLayer.data && apiLayer.data.apiNodes) || []).map((a) => a.name))
	const routeNodes = []
	for (const f of walk(absRoot)) {
		const b = path.basename(f)
		let kind = null
		if (routerMode === 'app') {
			if (/^page\.(t|j)sx?$/.test(b)) kind = 'page'
			else if (/^route\.(t|j)sx?$/.test(b)) kind = 'route'
		} else {
			kind = /(^|\/)api(\/|$)/.test(path.relative(absRoot, f).replace(/\\/g, '/')) ? 'route' : 'page'
		}
		if (!kind) continue
		const routePath = toRoutePath(f, absRoot, routerMode)
		const domains = [...followImportsToDomains(f, apiRootAbs, apiDomains, 2)].sort()
		routeNodes.push({ id: 'p:' + routePath, kind, name: routePath, apiRefs: domains.map((d) => 'a:' + d), meta: domains.length ? domains.join(', ') : '도메인 연결 없음' })
	}
	routeNodes.sort((a, b) => a.name.localeCompare(b.name))
	saveLayer('routes', { routeNodes, root: nextRoot, router: routerMode })
	return { ok: true, routes: routeNodes.length, router: routerMode }
}

// ── 조립 (프론트 ArchGraph 계약: dbGroups/apiNodes/routeNodes 정확히) ──
function graph() {
	const dbL = loadLayer('db')
	const apiL = loadLayer('api')
	const routesL = loadLayer('routes')
	const dbGroups = (dbL && dbL.data && dbL.data.dbGroups) || []
	const apiNodes = (apiL && apiL.data && apiL.data.apiNodes) || []
	const routeNodes = (routesL && routesL.data && routesL.data.routeNodes) || []
	return {
		ok: true,
		dbGroups,
		apiNodes,
		routeNodes,
		scannedAt: { db: (dbL && dbL.scannedAt) || null, api: (apiL && apiL.scannedAt) || null, routes: (routesL && routesL.scannedAt) || null },
		empty: !dbGroups.length && !apiNodes.length && !routeNodes.length,
	}
}

module.exports = { config, dbConnect, apiScan, nextScan, graph, buildDbGraph, prefixOf, toRoutePath, introspect }
