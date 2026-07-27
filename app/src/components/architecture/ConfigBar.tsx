interface PanelProps {
	dot: string
	title: string
	subtitle: string
	connected: boolean
	children: React.ReactNode
}

function Panel({ dot, title, subtitle, connected, children }: PanelProps) {
	return (
		<div style={{ border: '1px solid var(--line2)', borderRadius: 12, background: 'var(--card)', padding: '14px 15px' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
				<span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
				<span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{title}</span>
				<span style={{ fontSize: 11, color: 'var(--t3)' }}>{subtitle}</span>
				<span
					className="m"
					style={{
						marginLeft: 'auto',
						fontSize: 10,
						fontWeight: 700,
						color: connected ? 'var(--green)' : 'var(--t3)',
						background: connected ? 'color-mix(in srgb, var(--green) 15%, transparent)' : 'var(--card2)',
						borderRadius: 5,
						padding: '2px 7px',
					}}
				>
					{connected ? '연결됨' : '미연결'}
				</span>
			</div>
			<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
		</div>
	)
}

export default function ConfigBar({
	db,
	api,
	next,
	onDbChange,
	onApiChange,
	onNextChange,
	onConnectDb,
	onConnectApi,
	onConnectNext,
}: {
	db: { url: string; schema: string; connected: boolean }
	api: { root: string; base: string; connected: boolean }
	next: { root: string; port: string; router: 'app' | 'pages'; connected: boolean }
	onDbChange: (patch: Partial<{ url: string; schema: string }>) => void
	onApiChange: (patch: Partial<{ root: string; base: string }>) => void
	onNextChange: (patch: Partial<{ root: string; port: string; router: 'app' | 'pages' }>) => void
	onConnectDb: () => void
	onConnectApi: () => void
	onConnectNext: () => void
}) {
	return (
		<div style={{ flex: 'none', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, padding: '16px 30px', borderBottom: '1px solid var(--line)', background: 'var(--card2)' }}>
			<Panel dot="var(--arch-table)" title="DB" subtitle="Supabase / Postgres" connected={db.connected}>
				<input className="fin m" value={db.url} onChange={(e) => onDbChange({ url: e.target.value })} placeholder="postgresql://…  또는  https://xxx.supabase.co" />
				<input className="fin m" value={db.schema} onChange={(e) => onDbChange({ schema: e.target.value })} placeholder="schema (기본 public)" />
				<button
					onClick={onConnectDb}
					style={{ height: 32, borderRadius: 8, background: 'color-mix(in srgb, var(--arch-table) 20%, transparent)', border: '1px solid color-mix(in srgb, var(--arch-table) 45%, transparent)', cursor: 'pointer', color: 'var(--ink)', fontSize: 12, fontWeight: 700 }}
				>
					연결 · 스키마 introspect
				</button>
			</Panel>
			<Panel dot="var(--arch-domain)" title="API" subtitle="features 루트" connected={api.connected}>
				<input className="fin m" value={api.root} onChange={(e) => onApiChange({ root: e.target.value })} placeholder="src/features" />
				<input className="fin m" value={api.base} onChange={(e) => onApiChange({ base: e.target.value })} placeholder="API base URL (예: /api)" />
				<button
					onClick={onConnectApi}
					style={{ height: 32, borderRadius: 8, background: 'color-mix(in srgb, var(--arch-domain) 20%, transparent)', border: '1px solid color-mix(in srgb, var(--arch-domain) 45%, transparent)', cursor: 'pointer', color: 'var(--ink)', fontSize: 12, fontWeight: 700 }}
				>
					도메인 스캔
				</button>
			</Panel>
			<Panel dot="var(--arch-page)" title="Next.js" subtitle="app 라우터" connected={next.connected}>
				<input className="fin m" value={next.root} onChange={(e) => onNextChange({ root: e.target.value })} placeholder="src/app" />
				<div style={{ display: 'flex', gap: 8 }}>
					<input className="fin m" value={next.port} onChange={(e) => onNextChange({ port: e.target.value })} placeholder="port 3000" />
					<div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--line2)', flex: 'none' }}>
						<button
							onClick={() => onNextChange({ router: 'app' })}
							style={{ height: 24, padding: '0 9px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: next.router === 'app' ? 'var(--card2)' : 'transparent', color: next.router === 'app' ? 'var(--ink)' : 'var(--t3)' }}
						>
							app
						</button>
						<button
							onClick={() => onNextChange({ router: 'pages' })}
							style={{ height: 24, padding: '0 9px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: next.router === 'pages' ? 'var(--card2)' : 'transparent', color: next.router === 'pages' ? 'var(--ink)' : 'var(--t3)' }}
						>
							pages
						</button>
					</div>
				</div>
				<button
					onClick={onConnectNext}
					style={{ height: 32, borderRadius: 8, background: 'color-mix(in srgb, var(--arch-page) 20%, transparent)', border: '1px solid color-mix(in srgb, var(--arch-page) 45%, transparent)', cursor: 'pointer', color: 'var(--ink)', fontSize: 12, fontWeight: 700 }}
				>
					라우트 스캔
				</button>
			</Panel>
		</div>
	)
}
