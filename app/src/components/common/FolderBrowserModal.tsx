import { useEffect, useState } from 'react'
import Modal from './Modal'
import { listFs } from '../../api/setup'
import { useT } from '../../utils/i18n'

interface Entry {
	name: string
	path: string
}

// 서버 파일시스템을 직접 나열하는 폴더 브라우저 — showDirectoryPicker()(Safari/Firefox 미지원,
// 절대경로도 안 줌)에 의존하지 않고 어떤 브라우저에서도 실제 절대경로로 폴더를 고를 수 있게 한다.
export default function FolderBrowserModal({ open, startPath, onClose, onSelect }: { open: boolean; startPath: string; onClose(): void; onSelect(path: string): void }) {
	const t = useT()
	const [path, setPath] = useState(startPath || '~')
	const [parent, setParent] = useState<string | null>(null)
	const [entries, setEntries] = useState<Entry[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	function load(p: string) {
		setLoading(true)
		setError(null)
		listFs(p)
			.then((r) => {
				if (!r.ok) {
					setError(t(r.error || '읽기 실패'))
					return
				}
				setPath(r.path || p)
				setParent(r.parent ?? null)
				setEntries(r.entries || [])
			})
			.catch((e) => setError(e instanceof Error ? e.message : String(e)))
			.finally(() => setLoading(false))
	}

	useEffect(() => {
		if (open) load(startPath || '~')
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open])

	return (
		<Modal open={open} onClose={onClose} width={480}>
			<div style={{ padding: '20px 22px' }}>
				<div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{t('폴더 선택')}</div>
				<div className="m" style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={path}>
					{path}
				</div>
				<div className="scroll-y" style={{ height: 320, border: '1px solid var(--line2)', borderRadius: 10, background: 'var(--bg)' }}>
					{loading && <div style={{ padding: 16, fontSize: 12, color: 'var(--t3)' }}>{t('불러오는 중…')}</div>}
					{!loading && error && <div style={{ padding: 16, fontSize: 12, color: 'var(--red)' }}>{error}</div>}
					{!loading && !error && (
						<>
							{parent != null && (
								<div
									onClick={() => load(parent)}
									style={{ padding: '9px 14px', fontSize: 12.5, color: 'var(--t2)', cursor: 'pointer', borderBottom: '1px solid var(--line)' }}
								>
									{t('.. (상위 폴더)')}
								</div>
							)}
							{entries.length === 0 && parent == null && <div style={{ padding: 16, fontSize: 12, color: 'var(--t3)' }}>{t('하위 폴더 없음')}</div>}
							{entries.map((e) => (
								<div
									key={e.path}
									onClick={() => load(e.path)}
									style={{ padding: '9px 14px', fontSize: 12.5, color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
								>
									<span style={{ color: 'var(--violet)' }}>📁</span>
									{e.name}
								</div>
							))}
						</>
					)}
				</div>
				<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
					<button
						onClick={onClose}
						style={{ height: 34, padding: '0 14px', borderRadius: 8, background: 'transparent', border: '1px solid var(--line2)', cursor: 'pointer', color: 'var(--t2)', fontSize: 12.5 }}
					>
						{t('취소')}
					</button>
					<button
						disabled={!path || !!error}
						onClick={() => onSelect(path)}
						style={{ height: 34, padding: '0 16px', borderRadius: 8, background: 'var(--violet)', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 12.5, fontWeight: 700, opacity: !path || error ? 0.5 : 1 }}
					>
						{t('이 폴더 선택')}
					</button>
				</div>
			</div>
		</Modal>
	)
}
