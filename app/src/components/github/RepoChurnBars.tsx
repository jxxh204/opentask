export default function RepoChurnBars({ repos }: { repos: { repo: string; add: number; del: number }[] }) {
	const max = Math.max(...repos.map((r) => r.add + r.del), 1)
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
			{repos.map((r) => {
				const addPct = Math.round((r.add / max) * 100)
				const delPct = Math.round((r.del / max) * 100)
				return (
					<div key={r.repo} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
						<span className="m" style={{ fontSize: 11.5, color: 'var(--t2)', width: 190, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
							{r.repo}
						</span>
						<div style={{ flex: 1, height: 14, borderRadius: 5, background: 'var(--card2)', overflow: 'hidden', display: 'flex' }}>
							<div style={{ height: '100%', width: `${addPct}%`, background: 'var(--green)' }} />
							<div style={{ height: '100%', width: `${delPct}%`, background: 'var(--red)' }} />
						</div>
						<span className="m" style={{ fontSize: 11, color: 'var(--green)', width: 56, textAlign: 'right', flex: 'none' }}>+{r.add}</span>
						<span className="m" style={{ fontSize: 11, color: 'var(--red)', width: 56, textAlign: 'right', flex: 'none' }}>-{r.del}</span>
					</div>
				)
			})}
		</div>
	)
}
