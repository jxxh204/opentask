import { useEffect, useState } from 'react'
import { getWorktreeEnv, saveWorktreeEnv } from '../../api/worktreeEnv'
import type { WorktreeEnvVar } from '../../api/worktreeEnv'
import { useT, useTp } from '../../utils/i18n'
import styles from './ServerPane.module.css'

const TRASH_ICON = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
		<path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
	</svg>
)

// 프로토타입의 "로컬 서버" 탭 — 워크트리별 .env.local 편집 + 저장 시 그 포트의 dev 세션을 제자리
// 재시작(server/term.cjs Term.devSessionForPort/restartDevSession 재사용, 새 백엔드 로직 없음).
export default function ServerPane({ cwd }: { cwd: string }) {
	const t = useT()
	const tp = useTp()
	const [vars, setVars] = useState<WorktreeEnvVar[]>([])
	const [loaded, setLoaded] = useState(false)
	const [port, setPort] = useState('')
	const [saving, setSaving] = useState(false)
	const [log, setLog] = useState<string | null>(null)

	useEffect(() => {
		setLoaded(false)
		getWorktreeEnv(cwd)
			.then((r) => setVars(r.vars))
			.catch(() => setVars([]))
			.finally(() => setLoaded(true))
	}, [cwd])

	function updateVar(i: number, patch: Partial<WorktreeEnvVar>) {
		setVars((vs) => vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)))
	}
	function removeVar(i: number) {
		setVars((vs) => vs.filter((_, idx) => idx !== i))
	}

	async function save() {
		setSaving(true)
		setLog(null)
		try {
			const r = await saveWorktreeEnv({ cwd, vars, port: Number(port) || undefined })
			setLog(
				r.restarted
					? tp('✓ 저장 완료 · {target} 재시작됨', { target: r.restartedIn ?? t('세션') })
					: r.error
						? tp('저장됨 · {error}', { error: t(r.error) })
						: t('✓ 저장 완료'),
			)
		} catch (e) {
			setLog(tp('저장 실패: {msg}', { msg: e instanceof Error ? e.message : String(e) }))
		} finally {
			setSaving(false)
		}
	}

	if (!loaded) return <div className={styles.loading}>{t('불러오는 중…')}</div>

	return (
		<div className={styles.pad}>
			<div className={styles.section}>
				<div className={styles.head}>
					<span className={styles.label}>{tp('환경변수 · {path}/.env.local', { path: cwd.split('/').pop() ?? '' })}</span>
					<span className={styles.addBtn} onClick={() => setVars((vs) => [...vs, { key: '', value: '' }])}>
						{t('+ 추가')}
					</span>
				</div>
				<div className={styles.table}>
					{vars.map((v, i) => (
						<div key={i} className={styles.row}>
							<input className={styles.keyInput} placeholder="KEY" value={v.key} onChange={(e) => updateVar(i, { key: e.target.value })} />
							<div className={styles.valLine}>
								<input className={styles.valInput} placeholder="value" value={v.value} onChange={(e) => updateVar(i, { value: e.target.value })} />
								<span className={`${styles.iconBtn} ${styles.danger}`} onClick={() => removeVar(i)} title={t('삭제')}>
									{TRASH_ICON}
								</span>
							</div>
						</div>
					))}
					{vars.length === 0 && <div className={styles.empty}>{t('아직 변수 없음 — "+ 추가"로 시작하세요.')}</div>}
				</div>
				{log && <div className={styles.log}>{log}</div>}
				<div className={styles.foot}>
					<input className={styles.portInput} placeholder={t('재시작할 포트(선택)')} value={port} onChange={(e) => setPort(e.target.value)} />
					<span style={{ flex: 1 }} />
					<button className={styles.saveBtn} disabled={saving} onClick={save}>
						{saving ? t('저장 중…') : t('저장하고 재시작')}
					</button>
				</div>
			</div>
		</div>
	)
}
