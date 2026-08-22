import { api } from './client'

export type CronScheduleType = 'interval' | 'daily' | 'weekly'
export type CronSchedule = { minutes: number } | { hour: number; minute: number } | { dow: number; hour: number; minute: number }

export interface CronJob {
	id: string
	name: string
	schedule_type: CronScheduleType
	schedule: CronSchedule
	action_type: 'create_task'
	action: { name: string; desc?: string; repoId?: string | null }
	enabled: 0 | 1
	last_run_at: number | null
	next_run_at: number | null
	created_at: number
	updated_at: number
}

export function listCronJobs() {
	return api.get<CronJob[]>('/api/cron-jobs')
}
export function createCronJob(input: {
	name: string
	scheduleType: CronScheduleType
	schedule: CronSchedule
	action: { name: string; desc?: string; repoId?: string | null }
	enabled?: boolean
}) {
	return api.post<CronJob | { ok: false; error: string }>('/api/cron-jobs', input)
}
export function updateCronJob(id: string, patch: Partial<{ name: string; scheduleType: CronScheduleType; schedule: CronSchedule; enabled: boolean }>) {
	return api.patch<CronJob>(`/api/cron-jobs/${id}`, patch)
}
export function removeCronJob(id: string) {
	return api.delete<{ ok: boolean }>(`/api/cron-jobs/${id}`)
}
export function runCronJobNow(id: string) {
	return api.post<{ ok: boolean; job: CronJob }>(`/api/cron-jobs/${id}/run-now`)
}
