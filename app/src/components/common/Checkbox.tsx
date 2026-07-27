export default function Checkbox({ checked, onChange, size = 16 }: { checked: boolean; onChange(v: boolean): void; size?: number }) {
	return (
		<span
			onClick={(e) => {
				e.stopPropagation()
				onChange(!checked)
			}}
			style={{ width: size, height: size, flex: 'none', marginTop: 1, borderRadius: 5, border: `1.5px solid ${checked ? 'var(--blue)' : 'var(--t3)'}`, background: checked ? 'var(--blue)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
		>
			{checked && (
				<svg width={size * 0.7} height={size * 0.7} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
					<path d="M5 13l4 4L19 7" />
				</svg>
			)}
		</span>
	)
}
