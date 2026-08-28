import { create } from 'zustand'
import { startDurationEstimate, getDurationEstimateStatus, type DurationEstimateStatus } from '../api/sessions'
import type { Task } from './types'

// "다른 걸 하고 있어도 백그라운드에서 돌아서 다 되면 확인할 수 있게" — 예전엔 TaskDetailModal 안에
// jobId/폴링을 로컬 state로 들고 있어서 드로어를 닫으면(=컴포넌트 언마운트) 프론트가 진행 상황을
// 놓쳤다(백엔드 잡 자체는 계속 돌지만). 이 스토어로 옮겨서 드로어 마운트 여부와 무관하게 계속
// 폴링하고, 사이드바(SessionShell)에서도 같은 상태를 구독해 진행률을 보여줄 수 있게 한다.
// 태스크당 잡 1개만 추적 — 같은 태스크에서 다시 시작하면 이전 잡을 덮어쓴다(폴링도 자연히 멈춤,
// 아래 poll()의 jobId 일치 확인 덕분에 옛 폴링 루프가 새 잡 결과를 덮어쓰지 않는다).
export interface ReviewJob {
	taskId: string
	taskName: string
	jobId: string
	status: DurationEstimateStatus | null
	error: string | null
	// "적용이 되면 수정 안 되는 UI로... 수정 버튼을 눌러야 수정되도록" — 기간/설명 필드를 잠글지 여부.
	// 태스크별로 전역 스토어에 둬야 드로어를 닫았다 다른 태스크 봤다 와도(컴포넌트 안 언마운트되지만
	// 로컬 state였다면 review?.jobId가 같아도 리렌더 순서상 꼬일 수 있었다) 잠금 상태가 정확히 유지된다.
	applied: boolean
}

interface ReviewState {
	jobs: Record<string, ReviewJob>
	startReview(taskId: string, taskName: string): Promise<void>
	clearReview(taskId: string): void
	setApplied(taskId: string, applied: boolean): void
	hydrateFromTask(task: Task): void
}

export const useReviewStore = create<ReviewState>((set) => ({
	jobs: {},
	startReview: async (taskId, taskName) => {
		set((s) => ({ jobs: { ...s.jobs, [taskId]: { taskId, taskName, jobId: '', status: null, error: null, applied: false } } }))
		const r = await startDurationEstimate(taskId)
		if (!r.ok) {
			set((s) => ({ jobs: { ...s.jobs, [taskId]: { taskId, taskName, jobId: '', status: null, error: r.error, applied: false } } }))
			return
		}
		set((s) => ({ jobs: { ...s.jobs, [taskId]: { taskId, taskName, jobId: r.jobId, status: null, error: null, applied: false } } }))
		poll(taskId, r.jobId)
	},
	clearReview: (taskId) =>
		set((s) => {
			const jobs = { ...s.jobs }
			delete jobs[taskId]
			return { jobs }
		}),
	setApplied: (taskId, applied) =>
		set((s) => {
			const cur = s.jobs[taskId]
			if (!cur) return {}
			return { jobs: { ...s.jobs, [taskId]: { ...cur, applied } } }
		}),
	// "검토한 일감은... 사라지면안돼. 항상 불러와야해" — board가 실어주는 task.review(agent_jobs에
	// 영구 저장된 최근 완료 검토)로 스토어를 채운다. 이미 이 세션에서 만들어진 항목(활성 폴링 중이거나
	// 이미 한 번 하이드레이션됨)이 있으면 절대 덮지 않는다 — loadBoard()는 다른 조작 뒤에도 계속
	// 호출되므로, 매번 무조건 덮으면 사용자가 방금 시작한 새 검토의 실시간 진행률을 지워버린다.
	hydrateFromTask: (task) =>
		set((s) => {
			if (s.jobs[task.id] || !task.review) return {}
			return {
				jobs: {
					...s.jobs,
					[task.id]: {
						taskId: task.id,
						taskName: task.name,
						jobId: task.review.jobId,
						status: {
							ok: true,
							percent: 100,
							label: '완료',
							done: true,
							tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
							costUsd: null,
							elapsedMs: 0,
							result: task.review.result,
						},
						error: null,
						applied: false,
					},
				},
			}
		}),
}))

function poll(taskId: string, jobId: string) {
	async function tick() {
		const cur = useReviewStore.getState().jobs[taskId]
		if (!cur || cur.jobId !== jobId) return // 취소됐거나 같은 태스크에서 새 잡으로 교체됨 — 이 루프는 그만
		const s = await getDurationEstimateStatus(taskId, jobId)
		const stillCurrent = useReviewStore.getState().jobs[taskId]
		if (!stillCurrent || stillCurrent.jobId !== jobId) return
		if (!s.ok) {
			useReviewStore.setState((st) => ({ jobs: { ...st.jobs, [taskId]: { ...stillCurrent, error: s.error } } }))
			return
		}
		useReviewStore.setState((st) => ({ jobs: { ...st.jobs, [taskId]: { ...stillCurrent, status: s } } }))
		if (!s.done) setTimeout(tick, 800)
	}
	tick()
}
