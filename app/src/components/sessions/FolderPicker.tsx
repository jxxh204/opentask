import { useEffect, useRef, useState } from 'react'
import { resolveFsPath, type FsResolveResult } from '../../api/setup'
import FolderBrowserModal from '../common/FolderBrowserModal'
import styles from './FolderPicker.module.css'

// Resolved design (see plan §6 / §"FolderPicker"): showDirectoryPicker() can
// only ever hand back a directory handle's basename — browsers never expose a
// real OS path from it, for sandboxing reasons — so it is never the sole path
// source. The text input is always the source of truth; the picker (where
// supported) only prefills the last path segment, live-validated server-side
// via GET /api/setup/fs/resolve as the user types.
function mergeBasename(current: string, name: string): string {
	const trimmed = current.trim()
	if (!trimmed || trimmed.endsWith('/')) return trimmed + name
	const idx = trimmed.lastIndexOf('/')
	return idx === -1 ? name : trimmed.slice(0, idx + 1) + name
}

export default function FolderPicker({ label, value, onChange, kind }: { label: string; value: string; onChange(path: string): void; kind: 'root' | 'worktree' }) {
	const [status, setStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')
	const [info, setInfo] = useState<FsResolveResult | null>(null)
	const [browsing, setBrowsing] = useState(false)
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current)
		if (!value.trim()) {
			setStatus('idle')
			setInfo(null)
			return
		}
		setStatus('checking')
		debounceRef.current = setTimeout(async () => {
			try {
				const r = await resolveFsPath(value)
				setInfo(r)
				setStatus(r.exists && r.isDirectory ? 'valid' : 'invalid')
			} catch {
				setStatus('invalid')
			}
		}, 350)
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
		}
	}, [value])

	const pickerSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

	const pick = async () => {
		try {
			// @ts-expect-error — showDirectoryPicker isn't in the standard TS DOM lib yet
			const handle = await window.showDirectoryPicker()
			onChange(mergeBasename(value, handle.name))
		} catch {
			/* user cancelled the picker — leave the text field as-is */
		}
	}

	const statusText =
		status === 'checking'
			? '확인 중…'
			: status === 'valid'
				? info?.isGitRepo
					? `기존 레포 · 워크트리 ${info.existingWorktrees.length}개`
					: '폴더 확인됨'
				: status === 'invalid'
					? '폴더가 없습니다 · 생성될 예정'
					: ''

	return (
		<div>
			<div className={styles.row}>
				<div className={styles.inputWrap}>
					<input className="fin m" value={value} placeholder={kind === 'root' ? '~/projects/openrm' : '~/projects/.worktrees'} onChange={(e) => onChange(e.target.value)} />
				</div>
				<button type="button" className={styles.pickBtn} onClick={() => setBrowsing(true)}>
					폴더 찾아보기
				</button>
				{pickerSupported && (
					<button type="button" className={styles.pickBtn} onClick={pick} title="브라우저 기본 폴더 선택 (마지막 폴더명만 채워짐)">
						폴더 선택
					</button>
				)}
			</div>
			{status !== 'idle' && (
				<div className={`${styles.statusChip} ${status === 'valid' ? styles.statusValid : status === 'invalid' ? styles.statusInvalid : styles.statusChecking}`}>
					<span>{label}:</span>
					<span>{statusText}</span>
				</div>
			)}
			<FolderBrowserModal
				open={browsing}
				startPath={value || '~'}
				onClose={() => setBrowsing(false)}
				onSelect={(p) => {
					onChange(p)
					setBrowsing(false)
				}}
			/>
		</div>
	)
}
