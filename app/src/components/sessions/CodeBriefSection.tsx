import { useEffect, useState } from 'react'
import { generateCodeBrief, getCodeBriefs } from '../../api/sessions'
import type { CodeBrief } from '../../api/sessions'
import { useT, useTp } from '../../utils/i18n'
import styles from './TaskDetailModal.module.css'

// "API의 경우 변경된 API 엔드포인트, 혹은 엔드포인트별 변경점... 실제 판별 코드를 이런 조건에
// 보여지고 API에서는 이렇게 내려온다 식으로 간단하면서 확실하게" — 착수 시 자동 생성되는 pre(관련
// 기존 코드 참고)와 완료 시 자동 생성되는 post(실제 diff 기준 변경점)를 폴링해 보여준다(§ codeBrief.cjs).
// "Storybook에서 어디로 들어가야 하는지 알려주지 않는다" — storybook 필드가 정확한 딥링크.
function StageBlock({ subtaskId, stage, brief, label, emptyHint }: { subtaskId: string; stage: 'pre' | 'post'; brief: CodeBrief | null; label: string; emptyHint: string }) {
	const t = useT()
	const tp = useTp()
	const [regenBusy, setRegenBusy] = useState(false)
	async function regen() {
		setRegenBusy(true)
		try {
			await generateCodeBrief(subtaskId, stage)
		} finally {
			setRegenBusy(false)
		}
	}
	return (
		<div className={styles.briefCard}>
			<div className={styles.briefHead}>
				<span className={styles.briefKind}>{label}</span>
				{brief && brief.status !== 'pending' && (
					<span className={styles.briefOpenLink} onClick={regenBusy ? undefined : regen}>
						{regenBusy ? t('생성 중…') : t('다시 생성')}
					</span>
				)}
			</div>
			{!brief ? (
				<div className={styles.briefPending}>{emptyHint}</div>
			) : brief.status === 'pending' ? (
				<div className={styles.briefPending}>
					<span className={styles.briefSpinner} />
					{t('코드 조사 중…')}
				</div>
			) : brief.status === 'error' ? (
				<div className={styles.briefError}>{brief.error || t('생성 실패')}</div>
			) : (
				<>
					<div className={styles.briefSummary}>{brief.data?.summary}</div>
					{!!brief.data?.endpoints.length && (
						<div className={styles.briefEndpointList}>
							{brief.data.endpoints.map((e, i) => (
								<div key={i} className={styles.briefEndpoint}>
									<span className={styles.briefMethod}>{e.method}</span>
									<span className={styles.briefRefPath}>{e.path}</span>
									<span className={styles.briefEndpointNote}>{e.note}</span>
								</div>
							))}
						</div>
					)}
					{!!brief.data?.references.length &&
						brief.data.references.map((r, i) => (
							<div key={i} className={styles.briefRefItem}>
								<div className={styles.briefRefPath}>
									{r.path}
									{r.lines ? `:${r.lines}` : ''}
									{r.editorLink && (
										<a className={styles.briefEditorLink} href={r.editorLink} target="_blank" rel="noreferrer">
											{t('에디터로 열기')}
										</a>
									)}
								</div>
								{r.condition && <div className={styles.briefRefCondition}>{r.condition}</div>}
								{r.explanation && <div className={styles.briefRefExplanation}>{r.explanation}</div>}
							</div>
						))}
					{brief.data?.storybook && (
						<div className={styles.briefStorybookRow}>
							{brief.data.storybook.url ? (
								<a className={styles.briefStorybookLink} href={brief.data.storybook.url} target="_blank" rel="noreferrer">
									{tp('📕 Storybook에서 열기 — {label}', { label: brief.data.storybook.label })}
								</a>
							) : (
								<span className={styles.briefStorybookHint}>{tp('📕 관련 스토리: {label} (서버 미실행 — 경로만)', { label: brief.data.storybook.label })}</span>
							)}
						</div>
					)}
				</>
			)}
		</div>
	)
}

export default function CodeBriefSection({ subtaskId, started, ended }: { subtaskId: string; started: boolean; ended: boolean }) {
	const t = useT()
	const [pre, setPre] = useState<CodeBrief | null>(null)
	const [post, setPost] = useState<CodeBrief | null>(null)

	useEffect(() => {
		if (!started) return
		let cancelled = false
		let intervalId: number | null = null
		async function poll() {
			const r = await getCodeBriefs(subtaskId)
			if (cancelled || !r.ok) return
			setPre(r.pre)
			setPost(r.post)
			const preSettled = !r.pre || r.pre.status !== 'pending'
			const postSettled = !ended || !r.post || r.post.status !== 'pending'
			if (preSettled && postSettled && intervalId !== null) {
				window.clearInterval(intervalId)
				intervalId = null
			}
		}
		poll()
		intervalId = window.setInterval(poll, 4000)
		return () => {
			cancelled = true
			if (intervalId !== null) window.clearInterval(intervalId)
		}
	}, [subtaskId, started, ended])

	if (!started) return null

	return (
		<div className={styles.briefSection}>
			<div className={styles.descLabel}>{t('관련 코드')}</div>
			<StageBlock subtaskId={subtaskId} stage="pre" brief={pre} label={t('착수 전 참고')} emptyHint={t('곧 생성됩니다…')} />
			{ended && <StageBlock subtaskId={subtaskId} stage="post" brief={post} label={t('완료 후 변경점')} emptyHint={t('곧 생성됩니다…')} />}
		</div>
	)
}
