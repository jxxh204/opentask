import { useEffect, useMemo, useRef, useState } from 'react'
import { FIXTURE_GRAPH, getArchitectureConfig, getArchitectureGraph, connectDb, scanApi, scanNext, type ArchGraph } from '../api/architecture'
import DbColumn from '../components/architecture/DbColumn'
import ApiColumn from '../components/architecture/ApiColumn'
import RouteColumn from '../components/architecture/RouteColumn'
import ArchEdgesSvg from '../components/architecture/ArchEdgesSvg'
import ConfigBar from '../components/architecture/ConfigBar'
import { bezierPath, type Edge } from '../components/architecture/edgeMath'
import styles from './ArchitecturePage.module.css'

export default function ArchitecturePage() {
	const [mode, setMode] = useState<'view' | 'config'>('view')
	const [hi, setHi] = useState<Record<string, boolean> | null>(null)
	const [edges, setEdges] = useState<Edge[]>([])
	const canvasRef = useRef<HTMLDivElement>(null)
	const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({})

	const [db, setDb] = useState({ url: '', schema: '', connected: false })
	const [api, setApi] = useState({ root: '', base: '', connected: false })
	const [next, setNext] = useState<{ root: string; port: string; router: 'app' | 'pages'; connected: boolean }>({ root: '', port: '', router: 'app', connected: false })
	const [busy, setBusy] = useState<{ db?: boolean; api?: boolean; next?: boolean }>({})
	const [errors, setErrors] = useState<{ db?: string; api?: string; next?: string }>({})
	const [graph, setGraph] = useState<ArchGraph | null>(null)
	const [usingFixture, setUsingFixture] = useState(false)

	async function reload() {
		const [cfg, g] = await Promise.all([getArchitectureConfig().catch(() => null), getArchitectureGraph().catch(() => null)])
		if (cfg) {
			setDb((s) => ({ ...s, schema: cfg.db.schema || s.schema, connected: cfg.db.connected }))
			setApi((s) => ({ ...s, root: cfg.api.root || s.root, base: cfg.api.base || s.base, connected: cfg.api.connected }))
			setNext((s) => ({ ...s, root: cfg.next.root || s.root, port: cfg.next.port != null ? String(cfg.next.port) : s.port, router: cfg.next.router, connected: cfg.next.connected }))
		}
		if (g && !g.empty) {
			setGraph(g)
			setUsingFixture(false)
		} else {
			setGraph(FIXTURE_GRAPH)
			setUsingFixture(true)
		}
	}

	useEffect(() => {
		reload()
	}, [])

	async function onConnectDb() {
		setBusy((b) => ({ ...b, db: true }))
		setErrors((e) => ({ ...e, db: undefined }))
		try {
			const r = await connectDb(db.url.trim(), db.schema.trim())
			if (!r.ok) setErrors((e) => ({ ...e, db: r.error || '연결 실패' }))
			else await reload()
		} catch (e) {
			setErrors((s) => ({ ...s, db: e instanceof Error ? e.message : String(e) }))
		} finally {
			setBusy((b) => ({ ...b, db: false }))
		}
	}
	async function onConnectApi() {
		setBusy((b) => ({ ...b, api: true }))
		setErrors((e) => ({ ...e, api: undefined }))
		try {
			const r = await scanApi(api.root.trim(), api.base.trim())
			if (!r.ok) setErrors((e) => ({ ...e, api: r.error || '스캔 실패' }))
			else await reload()
		} catch (e) {
			setErrors((s) => ({ ...s, api: e instanceof Error ? e.message : String(e) }))
		} finally {
			setBusy((b) => ({ ...b, api: false }))
		}
	}
	async function onConnectNext() {
		setBusy((b) => ({ ...b, next: true }))
		setErrors((e) => ({ ...e, next: undefined }))
		try {
			const r = await scanNext(next.root.trim(), next.port.trim(), next.router)
			if (!r.ok) setErrors((e) => ({ ...e, next: r.error || '스캔 실패' }))
			else await reload()
		} catch (e) {
			setErrors((s) => ({ ...s, next: e instanceof Error ? e.message : String(e) }))
		} finally {
			setBusy((b) => ({ ...b, next: false }))
		}
	}

	const { dbGroups, apiNodes, routeNodes } = graph ?? FIXTURE_GRAPH
	const dbKindById = useMemo(() => {
		const m: Record<string, 'table' | 'fn'> = {}
		dbGroups.forEach((g) => g.nodes.forEach((n) => (m[n.id] = n.kind)))
		return m
	}, [dbGroups])
	const dbNameById = useMemo(() => {
		const m: Record<string, string> = {}
		dbGroups.forEach((g) => g.nodes.forEach((n) => (m[n.id] = n.name)))
		return m
	}, [dbGroups])
	const apiById = useMemo(() => Object.fromEntries(apiNodes.map((a) => [a.id, a])), [apiNodes])

	function registerRef(id: string, el: HTMLDivElement | null) {
		nodeRefs.current[id] = el
	}

	function hover(id: string) {
		if (mode === 'config') return
		const root = canvasRef.current
		if (!root) return
		const cr = root.getBoundingClientRect()
		const nextHi: Record<string, boolean> = { [id]: true }
		const nextEdges: Edge[] = []
		const el = (nid: string) => nodeRefs.current[nid]
		const linkDbApi = (dbId: string, apiId: string) => {
			const a = el(dbId)
			const b = el(apiId)
			if (!a || !b) return
			const color = dbKindById[dbId] === 'fn' ? 'var(--arch-fn)' : 'var(--arch-table)'
			nextEdges.push({ d: bezierPath(a.getBoundingClientRect(), b.getBoundingClientRect(), cr), color })
		}
		const linkApiPage = (apiId: string, pageId: string) => {
			const a = el(apiId)
			const b = el(pageId)
			if (!a || !b) return
			nextEdges.push({ d: bezierPath(a.getBoundingClientRect(), b.getBoundingClientRect(), cr), color: 'var(--arch-domain)' })
		}
		if (id.startsWith('a:')) {
			const a = apiById[id]
			a.dbRefs.forEach((dbId) => {
				nextHi[dbId] = true
				linkDbApi(dbId, id)
			})
			routeNodes.forEach((p) => {
				if (p.apiRefs.includes(id)) {
					nextHi[p.id] = true
					linkApiPage(id, p.id)
				}
			})
		} else if (id.startsWith('p:')) {
			const p = routeNodes.find((r) => r.id === id)
			p?.apiRefs.forEach((apiId) => {
				nextHi[apiId] = true
				linkApiPage(apiId, id)
				apiById[apiId]?.dbRefs.forEach((dbId) => {
					nextHi[dbId] = true
					linkDbApi(dbId, apiId)
				})
			})
		} else {
			apiNodes.forEach((a) => {
				if (a.dbRefs.includes(id)) {
					nextHi[a.id] = true
					linkDbApi(id, a.id)
					routeNodes.forEach((p) => {
						if (p.apiRefs.includes(a.id)) {
							nextHi[p.id] = true
							linkApiPage(a.id, p.id)
						}
					})
				}
			})
		}
		setHi(nextHi)
		setEdges(nextEdges)
	}

	function onLeave() {
		setHi(null)
		setEdges([])
	}

	return (
		<div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
			<div className={styles.header}>
				<div style={{ minWidth: 0 }}>
					<div className={styles.titleRow}>
						<span style={{ fontSize: 20 }}>🗂️</span>
						<h1 className={styles.title}>아키텍처</h1>
					</div>
					<p className={styles.subtitle}>
						DB (테이블 · 함수) <span style={{ color: 'var(--line2)' }}>→</span> API (도메인 queries/actions) <span style={{ color: 'var(--line2)' }}>→</span> Next.js (라우트) · <b style={{ color: 'var(--t2)' }}>보기</b>=의존성 추적 · <b style={{ color: 'var(--t2)' }}>설정</b>=레이어 직접 연결
						{usingFixture && (
							<span style={{ color: 'var(--amber)' }}> · 예시 데이터 — 설정에서 연결하면 실제 그래프로 교체됩니다</span>
						)}
					</p>
				</div>
				<div className={styles.segmented}>
					<button className={`${styles.segBtn} ${mode === 'view' ? styles.segBtnActive : ''}`} onClick={() => setMode('view')}>
						보기
					</button>
					<button className={`${styles.segBtn} ${mode === 'config' ? styles.segBtnActive : ''}`} onClick={() => setMode('config')}>
						설정
					</button>
				</div>
			</div>

			{mode === 'config' && (
				<ConfigBar
					db={db}
					api={api}
					next={next}
					busy={busy}
					errors={errors}
					onDbChange={(p) => setDb((s) => ({ ...s, ...p }))}
					onApiChange={(p) => setApi((s) => ({ ...s, ...p }))}
					onNextChange={(p) => setNext((s) => ({ ...s, ...p }))}
					onConnectDb={onConnectDb}
					onConnectApi={onConnectApi}
					onConnectNext={onConnectNext}
				/>
			)}

			<div ref={canvasRef} onMouseLeave={onLeave} style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', justifyContent: 'space-between', padding: '20px 30px 26px' }}>
				<ArchEdgesSvg edges={edges} />
				<DbColumn groups={dbGroups} hi={hi} onEnter={hover} registerRef={registerRef} />
				<ApiColumn nodes={apiNodes} dbNameById={dbNameById} hi={hi} onEnter={hover} registerRef={registerRef} />
				<RouteColumn nodes={routeNodes} hi={hi} onEnter={hover} registerRef={registerRef} />
			</div>
		</div>
	)
}
