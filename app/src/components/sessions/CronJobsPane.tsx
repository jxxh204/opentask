import { useEffect, useState } from 'react'
import { listCronJobs, createCronJob, updateCronJob, removeCronJob, runCronJobNow } from '../../api/cronJobs'
import type { CronJob, CronScheduleType } from '../../api/cronJobs'
import { listRepos } from '../../api/sessions'
import type { Repo } from '../../store/types'
import { useT, useTp, translate, translateP } from '../../utils/i18n'
import { useUiStore } from '../../store/useUiStore'
import styles from './CronJobsPane.module.css'

const DOW_LABEL = ['일', '월', '화', '수', '목', '금', '토']
// CalendarPane.tsx의 DOW_LABEL과 별개 배열(공유 안 함) — 여기도 같은 이유로 '월'(월요일) 글자가
// 전역 사전의 다른 '월'(예: 달력 "월간")과 충돌할 수 있어 로컬로만 번역한다.
const DOW_LABEL_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function dowLabel(i: number) {
	return useUiStore.getState().lang === 'en' ? DOW_LABEL_EN[i] : DOW_LABEL[i]
}

// 예전엔 라우터로 이동하는 별도 페이지(AutomationsPage, 레거시 듀얼레일 Shell 안)였다 — "모든 메뉴는
// 탭에서 나온다" 규칙에 따라 SessionShell 탭 콘텐츠로 이식. 로직은 동일, §07 "크론잡 생성" 그대로.
// 컴포넌트가 아닌 모듈 함수라 훅(useT/useTp) 대신 non-hook translate/translateP를 직접 쓴다.
function describeSchedule(job: CronJob) {
	if (job.schedule_type === 'interval' && 'minutes' in job.schedule) return translateP('{minutes}분마다', { minutes: job.schedule.minutes })
	if (job.schedule_type === 'daily' && 'hour' in job.schedule)
		return translateP('매일 {time}', { time: `${String(job.schedule.hour).padStart(2, '0')}:${String(job.schedule.minute).padStart(2, '0')}` })
	if (job.schedule_type === 'weekly' && 'dow' in job.schedule)
		return translateP('매주 {dow}요일 {time}', {
			dow: dowLabel(job.schedule.dow),
			time: `${String(job.schedule.hour).padStart(2, '0')}:${String(job.schedule.minute).padStart(2, '0')}`,
		})
	return '—'
}
function fmtTime(ts: number | null) {
	if (!ts) return '—'
	const d = new Date(ts)
	const now = new Date()
	const sameDay = d.toDateString() === now.toDateString()
	const date = sameDay ? translate('오늘') : `${d.getMonth() + 1}/${d.getDate()}`
	return `${date} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function NewJobForm({ repos, onCreated, onCancel }: { repos: Repo[]; onCreated: () => void; onCancel: () => void }) {
	const t = useT()
	const tp = useTp()
	const [name, setName] = useState('')
	const [scheduleType, setScheduleType] = useState<CronScheduleType>('daily')
	const [minutes, setMinutes] = useState(60)
	const [hour, setHour] = useState(9)
	const [minute, setMinute] = useState(0)
	const [dow, setDow] = useState(1)
	const [taskName, setTaskName] = useState('')
	const [taskDesc, setTaskDesc] = useState('')
	const [repoId, setRepoId] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function submit() {
		if (!name.trim() || !taskName.trim()) {
			setError(t('자동화 이름과 생성할 일감 제목은 필수입니다.'))
			return
		}
		setBusy(true)
		setError(null)
		try {
			const schedule = scheduleType === 'interval' ? { minutes } : scheduleType === 'daily' ? { hour, minute } : { dow, hour, minute }
			const r = await createCronJob({ name: name.trim(), scheduleType, schedule, action: { name: taskName.trim(), desc: taskDesc.trim(), repoId } })
			if ('ok' in r && r.ok === false) throw new Error(t(r.error))
			onCreated()
		} catch (e) {
			setError(t(e instanceof Error ? e.message : String(e)))
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className={styles.form}>
			<div className={styles.formRow}>
				<span className={styles.formLabel}>{t('자동화 이름')}</span>
				<input className="fin m" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('예: 매일 아침 백로그 정리')} />
			</div>
			<div className={styles.formRow}>
				<span className={styles.formLabel}>{t('주기')}</span>
				<div className={styles.scheduleTabs}>
					{(['interval', 'daily', 'weekly'] as const).map((st) => (
						<button key={st} type="button" className={`${styles.scheduleTab} ${scheduleType === st ? styles.scheduleTabActive : ''}`} onClick={() => setScheduleType(st)}>
							{st === 'interval' ? t('반복 간격') : st === 'daily' ? t('매일') : t('매주')}
						</button>
					))}
				</div>
			</div>
			{scheduleType === 'interval' && (
				<div className={styles.formRow}>
					<span className={styles.formLabel} />
					<input className="fin m" type="number" min={1} style={{ width: 90 }} value={minutes} onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))} />
					<span className={styles.formHint}>{t('분마다')}</span>
				</div>
			)}
			{(scheduleType === 'daily' || scheduleType === 'weekly') && (
				<div className={styles.formRow}>
					<span className={styles.formLabel} />
					{scheduleType === 'weekly' && (
						<select className="fin m" style={{ width: 90 }} value={dow} onChange={(e) => setDow(Number(e.target.value))}>
							{DOW_LABEL.map((_, i) => (
								<option key={i} value={i}>
									{tp('{dow}요일', { dow: dowLabel(i) })}
								</option>
							))}
						</select>
					)}
					<input className="fin m" type="number" min={0} max={23} style={{ width: 64 }} value={hour} onChange={(e) => setHour(Math.min(23, Math.max(0, Number(e.target.value) || 0)))} />
					<span className={styles.formHint}>{t('시')}</span>
					<input className="fin m" type="number" min={0} max={59} style={{ width: 64 }} value={minute} onChange={(e) => setMinute(Math.min(59, Math.max(0, Number(e.target.value) || 0)))} />
					<span className={styles.formHint}>{t('분')}</span>
				</div>
			)}
			<div className={styles.formDivider} />
			<div className={styles.formRow}>
				<span className={styles.formLabel}>{t('생성할 일감 제목')}</span>
				<input className="fin m" style={{ flex: 1 }} value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder={t('예: 백로그 정리 태스크')} />
			</div>
			<div className={styles.formRow}>
				<span className={styles.formLabel}>{t('설명(선택)')}</span>
				<input className="fin m" style={{ flex: 1 }} value={taskDesc} onChange={(e) => setTaskDesc(e.target.value)} />
			</div>
			{repos.length > 1 && (
				<div className={styles.formRow}>
					<span className={styles.formLabel}>{t('레포(선택)')}</span>
					<select className="fin m" style={{ width: 200 }} value={repoId ?? ''} onChange={(e) => setRepoId(e.target.value || null)}>
						<option value="">{t('(AI 자동배정)')}</option>
						{repos.map((r) => (
							<option key={r.id} value={r.id}>
								{r.name}
							</option>
						))}
					</select>
				</div>
			)}
			{error && <div className={styles.formError}>{error}</div>}
			<div className={styles.formActions}>
				<button className={styles.btnGhost} disabled={busy} onClick={onCancel}>
					{t('취소')}
				</button>
				<button className={styles.btnPrimary} disabled={busy} onClick={submit}>
					{busy ? t('만드는 중…') : t('자동화 만들기')}
				</button>
			</div>
		</div>
	)
}

export default function CronJobsPane() {
	const t = useT()
	const tp = useTp()
	const [jobs, setJobs] = useState<CronJob[] | null>(null)
	const [repos, setRepos] = useState<Repo[]>([])
	const [creating, setCreating] = useState(false)
	const [error, setError] = useState<string | null>(null)

	function load() {
		listCronJobs()
			.then(setJobs)
			.catch((e) => setError(t(e instanceof Error ? e.message : String(e))))
	}
	useEffect(() => {
		load()
		listRepos().then(setRepos).catch(() => {})
		const timer = setInterval(load, 30000)
		return () => clearInterval(timer)
	}, [])

	return (
		<div className={styles.wrap}>
			<div className={styles.header}>
				<div className={styles.titleRow}>
					<span className={styles.icon}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
							<rect x="3" y="5" width="18" height="16" rx="2.5" />
							<path d="M3 10h18M8 3v4M16 3v4" />
							<circle cx="15.5" cy="15.5" r="3.2" />
							<path d="M15.5 14v1.6l1.1.9" />
						</svg>
					</span>
					<span className={styles.title}>{t('크론잡')}</span>
					<span className={styles.subtitle}>{t('정해둔 시각에 일감을 자동으로 만듭니다 — 이 앱이 켜져 있는 동안만 동작합니다.')}</span>
				</div>
				{!creating && (
					<button className={styles.btnPrimary} onClick={() => setCreating(true)}>
						+ {t('새 자동화')}
					</button>
				)}
			</div>

			{creating && (
				<div className={styles.card}>
					<NewJobForm
						repos={repos}
						onCancel={() => setCreating(false)}
						onCreated={() => {
							setCreating(false)
							load()
						}}
					/>
				</div>
			)}

			{error && <div className={styles.formError}>{error}</div>}

			<div className={styles.list}>
				{jobs && jobs.length === 0 && !creating && <div className={styles.empty}>{t('아직 자동화가 없습니다. "+ 새 자동화"로 시작하세요.')}</div>}
				{jobs?.map((job) => (
					<div key={job.id} className={styles.jobCard}>
						<div className={styles.jobMain}>
							<span className={`${styles.jobDot} ${job.enabled ? styles.jobDotOn : styles.jobDotOff}`} />
							<div className={styles.jobBody}>
								<div className={styles.jobName}>{job.name}</div>
								<div className={styles.jobMeta}>{tp('{schedule} · 생성 일감: "{name}"', { schedule: describeSchedule(job), name: job.action.name })}</div>
							</div>
						</div>
						<div className={styles.jobStats}>
							<span>{tp('마지막 {time}', { time: fmtTime(job.last_run_at) })}</span>
							<span>{tp('다음 {time}', { time: job.enabled ? fmtTime(job.next_run_at) : t('꺼짐') })}</span>
						</div>
						<div className={styles.jobActions}>
							<button className={styles.jobBtn} onClick={() => runCronJobNow(job.id).then(load)}>
								{t('지금 실행')}
							</button>
							<button className={styles.jobBtn} onClick={() => updateCronJob(job.id, { enabled: !job.enabled }).then(load)}>
								{job.enabled ? t('끄기') : t('켜기')}
							</button>
							<button
								className={styles.jobBtnDanger}
								onClick={() => {
									if (confirm(tp('"{name}" 자동화를 삭제할까요?', { name: job.name }))) removeCronJob(job.id).then(load)
								}}
							>
								{t('삭제')}
							</button>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
