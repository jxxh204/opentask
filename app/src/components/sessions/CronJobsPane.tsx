import { useEffect, useState } from 'react'
import { listCronJobs, createCronJob, updateCronJob, removeCronJob, runCronJobNow } from '../../api/cronJobs'
import type { CronJob, CronScheduleType, CronActionType } from '../../api/cronJobs'
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
function describeAction(job: CronJob, t: ReturnType<typeof useT>, tp: ReturnType<typeof useTp>) {
	if (job.action_type === 'run_instruction' && 'instruction' in job.action) return tp('지시: "{text}"', { text: job.action.instruction })
	if ('name' in job.action) return tp('생성 일감: "{name}"', { name: job.action.name })
	return t('—')
}
function fmtTime(ts: number | null) {
	if (!ts) return '—'
	const d = new Date(ts)
	const now = new Date()
	const sameDay = d.toDateString() === now.toDateString()
	const date = sameDay ? translate('오늘') : `${d.getMonth() + 1}/${d.getDate()}`
	return `${date} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 성공/실패 배지는 백엔드가 실제로 들고 있는 신호에서만 유도한다 — scheduler.cjs의 runJob()은 실패 시
// 언제나 '실행 실패: '로 시작하는 문자열을 last_result에 남기고(§scheduler.cjs runJob catch/실패 분기),
// create_task 성공처럼 보고할 결과가 없는 액션은 last_result가 null인 채로 남는다. 그 외엔 실행 기록
// 자체가 없는 것(한 번도 안 돎)뿐이라 세 상태(성공/실패/안 돎)로 완전히 나뉜다 — 실행 이력 타임라인처럼
// 없는 데이터를 지어내지 않는다.
type JobStatus = 'success' | 'failed' | 'never'
function jobStatus(job: CronJob): JobStatus {
	if (!job.last_run_at) return 'never'
	if (job.last_result && job.last_result.startsWith('실행 실패:')) return 'failed'
	return 'success'
}
function StatusIcon({ status, t }: { status: JobStatus; t: ReturnType<typeof useT> }) {
	const cls = status === 'success' ? styles.statusSuccess : status === 'failed' ? styles.statusFailed : styles.statusNever
	const title = status === 'success' ? t('마지막 실행 성공') : status === 'failed' ? t('마지막 실행 실패') : t('아직 실행되지 않음')
	return (
		<span className={`${styles.statusIcon} ${cls}`} title={title}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
				{status === 'success' && (
					<>
						<circle cx="12" cy="12" r="9" />
						<path d="M8.3 12.3l2.4 2.4 5-5.4" />
					</>
				)}
				{status === 'failed' && (
					<>
						<circle cx="12" cy="12" r="9" />
						<path d="M9 9l6 6M15 9l-6 6" />
					</>
				)}
				{status === 'never' && (
					<>
						<circle cx="12" cy="12" r="9" strokeDasharray="2.4 3.2" />
					</>
				)}
			</svg>
		</span>
	)
}

function NewJobForm({ repos, onCreated, onCancel }: { repos: Repo[]; onCreated: () => void; onCancel: () => void }) {
	const t = useT()
	const tp = useTp()
	const [actionType, setActionType] = useState<CronActionType>('create_task')
	const [name, setName] = useState('')
	const [scheduleType, setScheduleType] = useState<CronScheduleType>('daily')
	const [minutes, setMinutes] = useState(60)
	const [hour, setHour] = useState(9)
	const [minute, setMinute] = useState(0)
	const [dow, setDow] = useState(1)
	const [taskDesc, setTaskDesc] = useState('')
	const [repoId, setRepoId] = useState<string | null>(null)
	const [instruction, setInstruction] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function submit() {
		if (!name.trim()) {
			setError(t('자동화 이름은 필수입니다.'))
			return
		}
		if (actionType === 'run_instruction' && !instruction.trim()) {
			setError(t('실행할 지시를 입력하세요.'))
			return
		}
		setBusy(true)
		setError(null)
		try {
			const schedule = scheduleType === 'interval' ? { minutes } : scheduleType === 'daily' ? { hour, minute } : { dow, hour, minute }
			const action = actionType === 'create_task' ? { name: name.trim(), desc: taskDesc.trim(), repoId } : { instruction: instruction.trim() }
			const r = await createCronJob({ name: name.trim(), scheduleType, schedule, actionType, action })
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
				<span className={styles.formLabel}>{t('실행 방식')}</span>
				<div className={styles.scheduleTabs}>
					{(['create_task', 'run_instruction'] as const).map((at) => (
						<button key={at} type="button" className={`${styles.scheduleTab} ${actionType === at ? styles.scheduleTabActive : ''}`} onClick={() => setActionType(at)}>
							{at === 'create_task' ? t('정형 — 태스크 생성') : t('자유 지시 — 무엇이든')}
						</button>
					))}
				</div>
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
			{actionType === 'create_task' ? (
				<>
					<div className={styles.formRow}>
						<span className={styles.formLabel}>{t('설명(선택)')}</span>
						<input className="fin m" style={{ flex: 1 }} value={taskDesc} onChange={(e) => setTaskDesc(e.target.value)} />
					</div>
					{repos.length > 1 && (
						<div className={styles.formRow}>
							<span className={styles.formLabel}>{t('레포(선택)')}</span>
							<select className="fin m" style={{ width: 200 }} value={repoId ?? ''} onChange={(e) => setRepoId(e.target.value || null)}>
								<option value="">{t('(레포 없음 — 나중에 상세 페이지에서 지정)')}</option>
								{repos.map((r) => (
									<option key={r.id} value={r.id}>
										{r.name}
									</option>
								))}
							</select>
						</div>
					)}
				</>
			) : (
				<div className={styles.formRow} style={{ alignItems: 'flex-start' }}>
					<span className={styles.formLabel}>{t('실행할 지시')}</span>
					<textarea
						className="fin m"
						style={{ flex: 1, minHeight: 64, resize: 'vertical' }}
						rows={3}
						value={instruction}
						onChange={(e) => setInstruction(e.target.value)}
						placeholder={t('예: 이번 주 완료되지 않은 서브태스크를 전부 다음 주로 재스케줄해줘')}
					/>
				</div>
			)}
			{actionType === 'run_instruction' && (
				<div className={styles.formHint} style={{ marginLeft: 116 }}>
					{t('이 시각이 되면 이 문장을 오버마인드에게 그대로 시키는 것과 똑같이 실행됩니다 — 매번 이 문장 그대로만 실행되고, AI가 즉흥적으로 범위를 넓히지 않습니다.')}
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
					<span className={styles.subtitle}>{t('정해둔 시각에 태스크를 만들거나, 자유롭게 쓴 지시를 그대로 실행합니다 — 이 앱이 켜져 있는 동안만 동작합니다.')}</span>
				</div>
				{!creating && jobs && jobs.length > 0 && (
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

			{jobs && jobs.length === 0 && !creating && (
				<button type="button" className={styles.emptyBtn} onClick={() => setCreating(true)}>
					{t('아직 자동화가 없습니다. 클릭해서 첫 자동화를 만드세요.')}
				</button>
			)}

			{jobs && jobs.length > 0 && (
				<div className={styles.table}>
					<div className={styles.theadRow}>
						<span className={styles.th} />
						<span className={styles.th}>{t('이름')}</span>
						<span className={styles.th}>{t('일정')}</span>
						<span className={styles.thRight}>{t('마지막 실행')}</span>
						<span className={styles.thRight}>{t('다음 실행')}</span>
						<span className={styles.thActions}>{t('작업')}</span>
					</div>
					{jobs.map((job) => (
						<div key={job.id} className={`${styles.jobRow} ${job.enabled ? '' : styles.jobRowDisabled}`}>
							<StatusIcon status={jobStatus(job)} t={t} />
							<div className={styles.jobBody}>
								<div className={styles.jobName}>{job.name}</div>
								<div className={styles.jobMeta}>{describeAction(job, t, tp)}</div>
								{job.last_result && <div className={styles.jobResult}>{job.last_result}</div>}
							</div>
							<div className={styles.jobSchedule}>{describeSchedule(job)}</div>
							<div className={styles.jobTime}>{fmtTime(job.last_run_at)}</div>
							<div className={styles.jobTime}>{job.enabled ? fmtTime(job.next_run_at) : t('꺼짐')}</div>
							<div className={styles.jobActions}>
								<button
									className={`${styles.switch} ${job.enabled ? styles.switchOn : ''}`}
									title={job.enabled ? t('끄기') : t('켜기')}
									onClick={() => updateCronJob(job.id, { enabled: !job.enabled }).then(load)}
								>
									<span className={styles.switchKnob} />
								</button>
								<span className={styles.iconBtn} title={t('지금 실행')} onClick={() => runCronJobNow(job.id).then(load)}>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
										<path d="M7 4.5v15l13-7.5-13-7.5z" />
									</svg>
								</span>
								<span
									className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
									title={t('삭제')}
									onClick={() => {
										if (confirm(tp('"{name}" 자동화를 삭제할까요?', { name: job.name }))) removeCronJob(job.id).then(load)
									}}
								>
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
										<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 .8 12.1a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9L18 7" />
									</svg>
								</span>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
