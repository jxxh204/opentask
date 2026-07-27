export type DotColor = 'green' | 'blue' | 'amber' | 'red' | 'violet' | 'muted'

const COLOR_VAR: Record<DotColor, string> = {
	green: 'var(--green)',
	blue: 'var(--blue)',
	amber: 'var(--amber)',
	red: 'var(--red)',
	violet: 'var(--violet)',
	muted: 'var(--t3)',
}

export default function StatusDot({ color, size = 8, pulse }: { color: DotColor; size?: number; pulse?: boolean }) {
	return <span style={{ width: size, height: size, borderRadius: '50%', background: COLOR_VAR[color], flex: 'none', display: 'inline-block', animation: pulse ? 'pulseDot 1.6s ease-in-out infinite' : undefined }} />
}
