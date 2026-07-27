import type { CSSProperties } from 'react'

export interface NodeVisual {
	opacity: number
	border: string
	background: string
	boxShadow: string
	badgeFg: string
	badgeBg: string
}

// hi=null: 아무것도 hover 안 됨(전부 진하게). hi={id:true,...}: 해당 노드만 강조, 나머진 흐리게.
export function nodeVisual(id: string, colorVar: string, hi: Record<string, boolean> | null): NodeVisual {
	const hovering = !!hi
	const on = !!(hi && hi[id])
	return {
		opacity: hovering ? (on ? 1 : 0.28) : 1,
		border: on ? colorVar : 'var(--line2)',
		background: on ? 'var(--card2)' : 'var(--card)',
		boxShadow: on ? `0 0 0 1px ${colorVar}, 0 6px 20px -8px ${colorVar}` : 'none',
		badgeFg: colorVar,
		badgeBg: `color-mix(in srgb, ${colorVar} 14%, transparent)`,
	}
}

export function cardStyle(v: NodeVisual): CSSProperties {
	return {
		border: `1px solid ${v.border}`,
		background: v.background,
		borderRadius: 11,
		padding: '11px 13px',
		cursor: 'pointer',
		opacity: v.opacity,
		boxShadow: v.boxShadow,
		transition: 'opacity .13s, border-color .13s',
	}
}
