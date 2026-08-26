import { useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '../../store/useSessionsStore'
import { useTabsStore } from '../../store/useTabsStore'
import { useReviewStore } from '../../store/useReviewStore'
import { removeTask, durationEstimateReportUrl } from '../../api/sessions'
import { getRepoColor } from '../../utils/repoColor'
import { addBusinessDays } from '../../utils/businessDays'
import type { Repo } from '../../store/types'
import BranchChain from './BranchChain'
import styles from './TaskDetailModal.module.css'

function pad(n: number) {
	return String(n).padStart(2, '0')
}
function msToDateInputValue(ms: number) {
	const d = new Date(ms)
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function dateInputValueToMs(v: string) {
	const [y, m, d] = v.split('-').map(Number)
	return new Date(y, m - 1, d).getTime()
}

// "이건 디자인된 드롭다운이었으면 하고 레포 색상은 내부에 있어야해" — 네이티브 <select>는 이 앱의
// 다른 곳(사이드바 레포 피커, SessionShell.tsx의 .repoSelect/.repoSelectPanel)에서 이미 쓰는 커스텀
// 드롭다운과 스타일이 다르다. 그 패턴을 그대로 이 컴포넌트 스코프에 옮겨 재사용 — 트리거 버튼 안에
// 선택된 레포의 색점을 넣고, 패널의 각 옵션 행에도 같은 색점을 붙인다.
function RepoSelect({ repos, valueId, onChange }: { repos: Repo[]; valueId: string | null; onChange(id: string | null): void }) {
	const [open, setOpen] = useState(false)
	const selected = repos.find((r) => r.id === valueId) ?? null

	useEffect(() => {
		if (!open) return
		const onDocClick = () => setOpen(false)
		document.addEventListener('click', onDocClick)
		return () => document.removeEventListener('click', onDocClick)
	}, [open])

	return (
		<span className={styles.repoSelect} onClick={(e) => e.stopPropagation()}>
			<button type="button" className={styles.repoSelectBtn} onClick={() => setOpen((o) => !o)}>
				<span className={styles.repoDot} style={{ background: selected ? getRepoColor(selected) : 'var(--line2)' }} />
				<span className={styles.repoSelectLabel}>{selected ? selected.name : '(선택 안 함)'}</span>
				<span className={`${styles.repoSelectChev} ${open ? styles.repoSelectChevOpen : ''}`}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
						<path d="M6 9l6 6 6-6" />
					</svg>
				</span>
			</button>
			{open && (
				<div className={styles.repoSelectPanel}>
					<div
						className={`${styles.repoSelectOpt} ${!valueId ? styles.repoSelectOptSelected : ''}`}
						onClick={() => {
							onChange(null)
							setOpen(false)
						}}
					>
						(선택 안 함)
					</div>
					{repos.map((r) => (
						<div
							key={r.id}
							className={`${styles.repoSelectOpt} ${valueId === r.id ? styles.repoSelectOptSelected : ''}`}
							onClick={() => {
								onChange(r.id)
								setOpen(false)
							}}
						>
							<span className={styles.repoDot} style={{ background: getRepoColor(r) }} />
							<span className={styles.repoSelectOptName}>{r.name}</span>
						</div>
					))}
				</div>
			)}
		</span>
	)
}

// "캘린더의 일감을 눌렀을 때 해당 일감의 내용이 나왔으면" — 전엔 칩을 누르면 바로 터미널 탭으로
// 점프했다(작업을 실제로 시작한 적 없는 미분류 일감도 마찬가지라 어색했다). Asana류 태스크 상세 참고
// UI로 요청받았으나, 담당자/하위작업/댓글처럼 이 앱에 없는 개념은 만들지 않고 실제로 있는 필드
// (제목/설명/마감일/레포/브랜치)만 그 톤으로 보여준다.
//
// "모달 말고 오른쪽에서 슬라이드인하는 사이드 메뉴로" 피드백으로 공용 Modal(중앙 오버레이) 대신
// DESIGN.md에 이미 문서화된 "드로어 플로트" 패턴(디버그 InspectorDrawer와 동일 — 오른쪽 고정,
// -16px 0 40px 그림자, transform translateX 트랜지션)을 그대로 따른다. Modal은 닫히면 즉시
// null을 반환해 언마운트되는데, 드로어는 슬라이드 아웃 되는 동안 계속 떠 있어야 해서 항상 마운트해
// 두고 transform으로만 여닫는다.
export default function TaskDetailModal({ taskId, onClose }: { taskId: string | null; onClose(): void }) {
	const inbox = useSessionsStore((s) => s.inbox)
	const folders = useSessionsStore((s) => s.folders)
	const repos = useSessionsStore((s) => s.repos)
	const renameTask = useSessionsStore((s) => s.renameTask)
	const updateTaskDesc = useSessionsStore((s) => s.updateTaskDesc)
	const updateTaskDueDate = useSessionsStore((s) => s.updateTaskDueDate)
	const updateTaskDuration = useSessionsStore((s) => s.updateTaskDuration)
	const updateTaskPrompt = useSessionsStore((s) => s.updateTaskPrompt)
	const updateTaskRepo = useSessionsStore((s) => s.updateTaskRepo)
	const setFolderRepo = useSessionsStore((s) => s.setFolderRepo)
	const quickStartTask = useSessionsStore((s) => s.quickStartTask)
	const setTaskDone = useSessionsStore((s) => s.setTaskDone)

	const open = taskId !== null
	// 닫히는 애니메이션이 도는 동안에도 내용이 그대로 보여야 한다 — taskId가 곧장 null이 되면 내용이
	// 슬라이드 아웃 되기 전에 먼저 사라져 버린다. 마지막으로 보여준 id를 따로 들고 있다가 열릴 때만 갱신.
	const [lastId, setLastId] = useState<string | null>(null)
	useEffect(() => {
		if (taskId) setLastId(taskId)
	}, [taskId])
	const quickStartBusy = useSessionsStore((s) => s.quickStartBusy === lastId)

	const found = lastId ? (inbox.find((t) => t.id === lastId) ?? folders.flatMap((f) => f.tasks).find((t) => t.id === lastId)) : null
	const folder = found?.folder_id ? folders.find((f) => f.id === found.folder_id) : null

	const [nameDraft, setNameDraft] = useState('')
	const [descDraft, setDescDraft] = useState('')
	const [removing, setRemoving] = useState(false)
	const nameRef = useRef<HTMLInputElement>(null)
	const descRef = useRef<HTMLTextAreaElement>(null)

	// "일감 검토" — 예전엔 잡 상태(jobId/폴링)를 이 컴포넌트 로컬 state로 들고 있어서 드로어를 닫으면
	// (=언마운트) 진행 상황을 놓쳤다. "다른 걸 하고 있어도 백그라운드에서 돌아서 다 되면 확인할 수
	// 있게" 요청으로 useReviewStore(태스크id 기준 전역, 드로어 마운트와 무관하게 계속 폴링)로 옮겼다 —
	// 이 컴포넌트는 그 상태를 구독만 한다. 사이드바(SessionShell)도 같은 스토어를 구독해 진행 목록을 보여준다.
	const review = useReviewStore((s) => (found ? s.jobs[found.id] : undefined))
	const startReview = useReviewStore((s) => s.startReview)
	const reviewBusy = !!review && !review.error && !review.status?.done

	// 열릴 때마다(다른 태스크로 바뀔 때도) 그 태스크의 현재 값으로 다시 채운다. AI 검토 상태는 여기서
	// 리셋하지 않는다 — useReviewStore가 태스크별로 독립적으로 들고 있으므로 다른 태스크를 봤다 와도 유지.
	useEffect(() => {
		if (found) {
			setNameDraft(found.name)
			setDescDraft(found.desc)
			setRemoving(false)
		}
	}, [found?.id]) // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (!open) return
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose()
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [open, onClose])

	function commitName() {
		if (found && nameDraft.trim() && nameDraft !== found.name) renameTask(found.id, nameDraft.trim())
	}
	function commitDesc() {
		if (found && descDraft !== found.desc) updateTaskDesc(found.id, descDraft)
	}
	function runAiReview() {
		if (!found || reviewBusy) return
		startReview(found.id, found.name)
	}
	function applyAiEstimate() {
		if (!found || !review?.status?.result?.ok) return
		updateTaskDuration(found.id, review.status.result.days)
	}
	// "조사 결과로 개발 계획까지" — 같은 조사 결과 재사용, 추가 탐색 없이 판단 단계가 함께 낸 순서
	// 있는 개발 계획을 오케스트레이터가 실제로 읽는 start_prompt에 반영한다(§12 "AI 제안 + 사람이
	// 자유롭게 덮어쓰기" — 여기서도 "적용"을 눌러야만 반영, 자동 저장 아님).
	function applyAiPlan() {
		if (!found || !review?.status?.result?.ok || !review.status.result.plan.length) return
		updateTaskPrompt(found.id, review.status.result.plan.join('\n'))
	}
	// "일감 내용 자체를 변경해버리면" — 조사로 알아낸 내용을 종합해 다듬은 설명으로 desc를 통째로 교체.
	function applyBetterDesc() {
		if (!found || !review?.status?.result?.ok || !review.status.result.betterDesc) return
		setDescDraft(review.status.result.betterDesc)
		updateTaskDesc(found.id, review.status.result.betterDesc)
	}
	function openWorkspace() {
		if (!found) return
		useTabsStore.getState().setActiveNode(found.id, 'terminal')
		onClose()
	}
	async function register() {
		if (!found) return
		await quickStartTask(found.id)
		onClose()
	}
	// "이걸 보고 태스크 등록 버튼이 나와서 그걸 누르면 태스크 등록과 해당 일정이 캘린더에도 등록되는거지"
	// — 검토 결과의 영업일을 적용하고(마감일이 없으면 오늘로 기본값, NewTaskModal과 동일 관례), 곧바로
	// 오케스트레이션까지 시작한다 — 세 번 나눠 누르지 않고 한 번에.
	async function registerFromReview() {
		if (!found || !review?.status?.result?.ok) return
		if (found.due_date == null) await updateTaskDueDate(found.id, Date.now())
		await updateTaskDuration(found.id, review.status.result.days)
		await quickStartTask(found.id)
		onClose()
	}
	async function remove() {
		if (!found || !confirm(`"${found.name}"을(를) 삭제할까요?`)) return
		setRemoving(true)
		await removeTask(found.id)
		await useSessionsStore.getState().loadBoard()
		onClose()
	}

	return (
		<div className={styles.overlay} style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }} onClick={onClose}>
			<div className={styles.drawer} style={{ transform: open ? 'translateX(0)' : 'translateX(100%)' }} onClick={(e) => e.stopPropagation()}>
				{found && (
					<>
						<div className={styles.head}>
							<input
								ref={nameRef}
								className={styles.nameInput}
								style={found.completed_at ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}
								value={nameDraft}
								onChange={(e) => setNameDraft(e.target.value)}
								onBlur={commitName}
								onKeyDown={(e) => {
									if (e.key === 'Enter') nameRef.current?.blur()
								}}
							/>
							{/* "일감 완료 체크가 있으면 좋겠어. 그걸하면 그냥 완료로 보이는거야" — 체크하면 레코드는
							    안 지우고 completed_at만 찍혀 태스크 트리에서 사라진다(캘린더엔 그대로 남음). 여기가
							    유일하게 다시 되돌릴 수 있는 자리라 체크박스로 토글 가능하게 둔다. */}
							<label className={styles.doneToggle} title="완료 처리 — 태스크 트리에서는 사라지고 캘린더에는 남습니다">
								<input type="checkbox" checked={!!found.completed_at} onChange={(e) => setTaskDone(found.id, e.target.checked)} />
								완료
							</label>
							<button type="button" className={styles.closeBtn} onClick={onClose} title="닫기">
								×
							</button>
						</div>

						<div className={styles.body}>
							{/* "일감 검토로... 제목 근처 라인으로 버튼 옮기고" — 태스크를 열자마자 가장 먼저 보이는
							    자리로 옮겼다. 이제 기간 추정뿐 아니라 개발 계획·설명 보강까지 한 번에 나온다. */}
							<div className={styles.reviewBlock}>
								<button
									type="button"
									className={styles.reviewBtn}
									disabled={reviewBusy || !descDraft.trim()}
									onClick={runAiReview}
									title={
										!descDraft.trim()
											? '설명을 먼저 적어주세요'
											: 'Claude Code로 구현+테스트까지 걸릴 영업일, 개발 계획, 보강된 설명을 검토합니다 — 코드를 직접 확인하느라 몇 분 걸릴 수 있어요. 드로어를 닫아도 백그라운드에서 계속 돌고, 사이드바에서 진행 상황을 볼 수 있어요.'
									}
								>
									{reviewBusy ? '검토 중…' : '일감 검토'}
								</button>
								{review?.error && (
									<div className={styles.aiSuggestBox}>
										<span className={styles.aiSuggestError}>{review.error}</span>
									</div>
								)}
								{reviewBusy && review?.status && (
									<div className={styles.aiSuggestBox}>
										<div className={styles.aiProgressLabel}>
											<span>{review.status.label ?? '준비 중…'}</span>
											<span>{review.status.percent ?? 5}%</span>
										</div>
										<div className={styles.aiProgressTrack}>
											<div className={styles.aiProgressFill} style={{ transform: `scaleX(${(review.status.percent ?? 5) / 100})` }} />
										</div>
										<div className={styles.aiProgressTokens}>
											토큰 {(review.status.tokens.input + review.status.tokens.output + review.status.tokens.cacheRead + review.status.tokens.cacheCreation).toLocaleString('ko-KR')} ·{' '}
											{Math.round(review.status.elapsedMs / 1000)}초
										</div>
									</div>
								)}
								{review?.status?.done && review.status.result && (
									<div className={styles.aiSuggestBox}>
										{review.status.result.ok ? (
											<>
												<div className={styles.aiSuggestHead}>
													<span className={styles.aiSuggestTotal}>일감 검토 — 총 {review.status.result.days}일</span>
													<a className={styles.aiReportLink} href={durationEstimateReportUrl(found.id, review.jobId)} target="_blank" rel="noreferrer">
														자세히 보기
													</a>
													<button type="button" className={styles.aiSuggestApply} onClick={applyAiEstimate}>
														기간 적용
													</button>
												</div>
												<ul className={styles.aiBreakdownList}>
													{review.status.result.breakdown.map((b, i) => (
														<li key={i} className={styles.aiBreakdownRow}>
															<span className={styles.aiBreakdownItem}>{b.item}</span>
															<span className={styles.aiBreakdownDays}>{b.days}일</span>
															<span className={styles.aiBreakdownNote}>{b.note}</span>
														</li>
													))}
												</ul>
												{review.status.result.betterDesc && (
													<div className={styles.aiPlanRow}>
														<span className={styles.aiPlanHint}>설명도 다듬었어요: "{review.status.result.betterDesc.slice(0, 50)}…"</span>
														<button type="button" className={styles.aiSuggestApply} onClick={applyBetterDesc}>
															설명 적용
														</button>
													</div>
												)}
												{review.status.result.plan.length > 0 && (
													<div className={styles.aiPlanRow}>
														<span className={styles.aiPlanHint}>개발 계획 {review.status.result.plan.length}단계도 함께 나왔어요(자세히 보기에서 확인)</span>
														<button
															type="button"
															className={styles.aiSuggestApply}
															onClick={applyAiPlan}
															title="task.start_prompt에 반영 — 실제 작업 시작 시 오케스트레이터가 이 계획으로 시작합니다"
														>
															계획 적용
														</button>
													</div>
												)}
												{!folder && (
													<div className={styles.aiRegisterRow}>
														<span className={styles.aiPlanHint}>검토 결과대로 등록하면 기간이 반영되고 캘린더에도 일정이 잡혀요</span>
														<button type="button" className={styles.aiRegisterBtn} disabled={quickStartBusy} onClick={registerFromReview}>
															{quickStartBusy ? '등록 중…' : '태스크 등록'}
														</button>
													</div>
												)}
												<div className={styles.aiProgressTokens}>
													토큰{' '}
													{(review.status.tokens.input + review.status.tokens.output + review.status.tokens.cacheRead + review.status.tokens.cacheCreation).toLocaleString(
														'ko-KR',
													)}
													{review.status.costUsd != null ? ` · 약 $${review.status.costUsd.toFixed(3)}` : ''}
												</div>
											</>
										) : review.status.result.tooVague ? (
											<div className={styles.aiSuggestWarn}>
												<span>설명이 너무 막연해서 검토를 중단했습니다 — {review.status.result.error}</span>
												<a className={styles.aiReportLink} href={durationEstimateReportUrl(found.id, review.jobId)} target="_blank" rel="noreferrer">
													조사 내용 보기
												</a>
												<button type="button" className={styles.aiSuggestWarnFocus} onClick={() => descRef.current?.focus()}>
													설명 작성하러 가기
												</button>
											</div>
										) : (
											<span className={styles.aiSuggestError}>{review.status.result.error}</span>
										)}
									</div>
								)}
							</div>

							<div className={styles.metaRow}>
								<span className={styles.metaLabel}>마감일</span>
								<input
									type="date"
									className="fin m"
									style={{ width: 150, height: 30 }}
									value={found.due_date ? msToDateInputValue(found.due_date) : ''}
									onChange={(e) => updateTaskDueDate(found.id, e.target.value ? dateInputValueToMs(e.target.value) : null)}
								/>
								{found.due_date !== null && (
									<button type="button" className={styles.metaClear} onClick={() => updateTaskDueDate(found.id, null)}>
										지우기
									</button>
								)}
							</div>

							{found.due_date !== null && (
								<div className={styles.metaRow}>
									<span className={styles.metaLabel}>기간</span>
									<input
										type="number"
										min={1}
										className="fin m"
										style={{ width: 56, height: 30 }}
										placeholder="1"
										value={found.duration_days ?? ''}
										onChange={(e) => {
											const v = e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null
											updateTaskDuration(found.id, v)
										}}
									/>
									<span className={styles.metaHint}>영업일</span>
									{found.duration_days !== null && found.duration_days > 1 && (
										<span className={styles.metaHint}>
											~ {new Date(addBusinessDays(found.due_date, found.duration_days)).getMonth() + 1}월{' '}
											{new Date(addBusinessDays(found.due_date, found.duration_days)).getDate()}일 종료
										</span>
									)}
									{found.duration_days !== null && (
										<button type="button" className={styles.metaClear} onClick={() => updateTaskDuration(found.id, null)}>
											지우기
										</button>
									)}
								</div>
							)}

							{repos.length > 0 && (
								<div className={styles.metaRow}>
									<span className={styles.metaLabel}>레포</span>
									<RepoSelect
										repos={repos}
										valueId={(folder ? folder.repo_id : found.repo_id) ?? null}
										onChange={(repoId) => {
											// 폴더로 승격된 태스크는 레포가 폴더 단위 배정(§ folders.repo_id 마이그레이션) —
											// 여기서 바꾸면 그 폴더의 다른 서브태스크에도 같이 적용된다. 미분류(inbox) 태스크는 자기 것만.
											if (folder) setFolderRepo(folder.id, repoId)
											else updateTaskRepo(found.id, repoId)
										}}
									/>
									{!folder && found.repo_id && <span className={styles.metaHint}>(AI 자동배정)</span>}
								</div>
							)}

							<div className={styles.descLabel}>설명</div>
							<textarea
								ref={descRef}
								className={styles.descInput}
								value={descDraft}
								onChange={(e) => setDescDraft(e.target.value)}
								onBlur={commitDesc}
								placeholder="이 일감에 대해 설명해 주세요"
							/>

							{found.branches.length > 0 && (
								<div className={styles.branchSection}>
									<div className={styles.descLabel}>브랜치</div>
									<BranchChain branches={found.branches} kind={found.kind} groupBase={folder?.base ?? null} />
								</div>
							)}
						</div>

						<div className={styles.actions}>
							<button type="button" className={styles.deleteBtn} disabled={removing} onClick={remove}>
								삭제
							</button>
							<div className={styles.actionsSpacer} />
							{folder ? (
								<button type="button" className={styles.primaryBtn} onClick={openWorkspace}>
									작업 열기
								</button>
							) : (
								<button type="button" className={styles.primaryBtn} disabled={quickStartBusy} onClick={register}>
									{quickStartBusy ? '등록 중…' : '태스크로 등록'}
								</button>
							)}
						</div>
					</>
				)}
			</div>
		</div>
	)
}
