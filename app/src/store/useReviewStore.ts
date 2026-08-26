import { create } from 'zustand'
import { startDurationEstimate, getDurationEstimateStatus, type DurationEstimateStatus } from '../api/sessions'

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
}

interface ReviewState {
	jobs: Record<string, ReviewJob>
	startReview(taskId: string, taskName: string): Promise<void>
	clearReview(taskId: string): void
}

export const useReviewStore = create<ReviewState>((set) => ({
	jobs: {},
	startReview: async (taskId, taskName) => {
		set((s) => ({ jobs: { ...s.jobs, [taskId]: { taskId, taskName, jobId: '', status: null, error: null } } }))
		const r = await startDurationEstimate(taskId)
		if (!r.ok) {
			set((s) => ({ jobs: { ...s.jobs, [taskId]: { taskId, taskName, jobId: '', status: null, error: r.error } } }))
			return
		}
		set((s) => ({ jobs: { ...s.jobs, [taskId]: { taskId, taskName, jobId: r.jobId, status: null, error: null } } }))
		poll(taskId, r.jobId)
	},
	clearReview: (taskId) =>
		set((s) => {
			const jobs = { ...s.jobs }
			delete jobs[taskId]
			return { jobs }
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
