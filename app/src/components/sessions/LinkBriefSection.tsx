import { useEffect, useRef, useState } from 'react'
import { ensureLinkBrief, listLinkBriefs } from '../../api/sessions'
import type { LinkBrief } from '../../api/sessions'
import { useGlobalTabsStore } from '../../store/useGlobalTabsStore'
import { useT } from '../../utils/i18n'
import styles from './TaskDetailModal.module.css'

function linkKind(url: string): 'figma' | 'doc' | null {
	const s = url.toLowerCase()
	if (s.includes('figma.com')) return 'figma'
	if (s.includes('notion')) return 'doc'
	return null
}

// "태스크 상세에 너무 정보가 없어. 노션·피그마 파일에서 중요한 정보들은 외부에서도 보여야해
// 요약해서라도... 개발할 때 이것만 보면 개발할 수 있다 정도 요약정보" — 설명에서 뽑힌 링크 중
// 노션·피그마만 골라 서버(§ linkBrief.cjs)에 요약 생성을 맡기고, 다 될 때까지 짧게 폴링한다.
// 자동 생성(사용자 선택)이라 이 컴포넌트가 마운트되고 링크가 보이는 순간 곧장 시작된다.
export default function LinkBriefSection({ ownerType, ownerId, links, groupName, groupColor }: { ownerType: 'task' | 'subtask'; ownerId: string; links: string[]; groupName?: string | null; groupColor?: string | null }) {
	const t = useT()
	const targets = links.map((url) => ({ url, kind: linkKind(url) })).filter((x): x is { url: string; kind: 'figma' | 'doc' } => x.kind !== null)
	const [briefs, setBriefs] = useState<Record<string, LinkBrief>>({})
	const startedRef = useRef<Set<string>>(new Set())

	useEffect(() => {
		if (!targets.length) return
		let cancelled = false
		for (const { url } of targets) {
			if (startedRef.current.has(url)) continue
			startedRef.current.add(url)
			ensureLinkBrief(ownerType, ownerId, url).catch(() => {})
		}
		let intervalId: number | null = null
		// 폴링 정지 조건은 방금 받아온 응답(byUrl)으로 판단한다 — setInterval 클로저가 캡처한 옛 state로
		// 판단하면 그 state가 절대 안 바뀐 것처럼 보여(effect가 재실행되지 않으니) 다 끝나도 계속 돈다.
		async function poll() {
			const r = await listLinkBriefs(ownerType, ownerId)
			if (cancelled || !r.ok) return
			const byUrl: Record<string, LinkBrief> = {}
			for (const b of r.briefs) byUrl[b.url] = b
			setBriefs(byUrl)
			const stillPending = targets.some(({ url }) => !byUrl[url] || byUrl[url].status === 'pending')
			if (!stillPending && intervalId !== null) {
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
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ownerType, ownerId, links.join('|')])

	if (!targets.length) return null

	function openBrief(url: string, title: string) {
		useGlobalTabsStore.getState().openBrowserTab(title, url, ownerType === 'task' ? ownerId : null, groupName ?? null, groupColor ?? null)
	}

	return (
		<div className={styles.briefSection}>
			<div className={styles.descLabel}>{t('개발 브리핑')}</div>
			{targets.map(({ url, kind }) => {
				const brief = briefs[url]
				return (
					<div key={url} className={styles.briefCard}>
						<div className={styles.briefHead}>
							<span className={styles.briefKind}>{kind === 'figma' ? t('피그마') : t('노션')}</span>
							<span className={styles.briefOpenLink} onClick={() => openBrief(url, kind === 'figma' ? t('피그마') : t('노션'))}>
								{t('자세히 보기 ↗')}
							</span>
						</div>
						{!brief || brief.status === 'pending' ? (
							<div className={styles.briefPending}>
								<span className={styles.briefSpinner} />
								{t('요약 생성 중…')}
							</div>
						) : brief.status === 'error' ? (
							<div className={styles.briefError}>
								{brief.error || t('요약 생성 실패')}
								<span className={styles.briefRetry} onClick={() => ensureLinkBrief(ownerType, ownerId, url).catch(() => {})}>
									{t('다시 시도')}
								</span>
							</div>
						) : (
							<>
								{brief.data?.imageUrl && <img className={styles.briefImage} src={brief.data.imageUrl} alt="" />}
								<div className={styles.briefSummary}>{brief.data?.summary}</div>
								{!!brief.data?.policies.length && (
									<ul className={styles.briefPolicies}>
										{brief.data.policies.map((p, i) => (
											<li key={i}>{p}</li>
										))}
									</ul>
								)}
							</>
						)}
					</div>
				)
			})}
		</div>
	)
}
