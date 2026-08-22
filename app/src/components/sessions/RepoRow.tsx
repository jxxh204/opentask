import type { Repo } from '../../store/types'
import styles from './RepoTable.module.css'

export default function RepoRow({ repo, onUpdate, onRemove }: { repo: Repo; onUpdate(patch: Partial<{ name: string; path: string; base: string; description: string }>): void; onRemove(): void }) {
	return (
		<div className={styles.row}>
			<input className="fin m" value={repo.name} placeholder="백엔드" onChange={(e) => onUpdate({ name: e.target.value })} />
			<input className="fin m" value={repo.path} placeholder="~/projects/service-backend" onChange={(e) => onUpdate({ path: e.target.value })} />
			<input className="fin m" value={repo.base ?? ''} placeholder="dev" onChange={(e) => onUpdate({ base: e.target.value })} />
			<input className="fin m" value={repo.description} placeholder="예: JSP 관리자 페이지, 백엔드 API" onChange={(e) => onUpdate({ description: e.target.value })} />
			<span className={styles.removeBtn} title="삭제" onClick={onRemove}>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
					<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</span>
		</div>
	)
}
