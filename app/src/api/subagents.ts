import { api } from './client'

export interface SubagentEntry {
	subagentType: string
	description: string
	at: string | null
}

// ~/.claude/projects/<cwd 인코딩>/*.jsonl 트랜스크립트에서 실제 Task 툴 호출(서브에이전트)을 읽어온다.
export function getWorktreeSubagents(cwd: string) {
	return api.get<{ ok: boolean; subagents: SubagentEntry[] }>(`/api/worktree/subagents?cwd=${encodeURIComponent(cwd)}`)
}
