import { api } from './client'

export interface WorktreeEnvVar {
	key: string
	value: string
}

export function getWorktreeEnv(cwd: string) {
	return api.get<{ ok: boolean; vars: WorktreeEnvVar[]; cwd: string }>(`/api/worktree/env?cwd=${encodeURIComponent(cwd)}`)
}

export function saveWorktreeEnv(input: { cwd: string; vars: WorktreeEnvVar[]; port?: number }) {
	return api.post<{ ok: boolean; restarted: boolean; restartedIn?: string; error?: string }>('/api/worktree/env', input)
}
