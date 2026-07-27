import { useState } from 'react'

// Replaces the prototype's proprietary <image-slot> custom element — plain
// <img> with a graceful fallback if the CDN logo 404s (this app is local-only
// and may run offline).
export default function ConnectorLogo({ src, alt, size = 30 }: { src?: string; alt: string; size?: number }) {
	const [failed, setFailed] = useState(false)
	if (!src || failed) {
		return (
			<span
				style={{
					width: size,
					height: size,
					flex: 'none',
					borderRadius: 9,
					background: 'var(--card2)',
					border: '1px solid var(--line2)',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontSize: size * 0.4,
					color: 'var(--t3)',
				}}
				title={alt}
			>
				{alt.slice(0, 1)}
			</span>
		)
	}
	return <img src={src} alt={alt} width={size} height={size} style={{ flex: 'none', borderRadius: 9, objectFit: 'contain' }} onError={() => setFailed(true)} />
}
