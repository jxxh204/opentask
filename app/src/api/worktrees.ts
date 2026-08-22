import { api } from './client'

export interface RealWorktree {
	path: string
	name: string
	branch: string
	ticket: string | null
	head: string | null
	dirty: number
	dirtySrc: number
	lastRel: string | null
	lastSubject: string | null
	author: string | null
	lastTs: number
	ahead: number
	behind: number
	isMain: boolean
}

export interface RepoWorktrees {
	base: string
	count: number
	worktrees: RealWorktree[]
	builtAt: string
}

// git worktree list --porcelain 그대로 — OpenTask가 태스크로 추적 중인지 여부와 무관하게 그 레포의
// 실제 워크트리 전부를 돌려준다. 추적 여부는 프론트에서 folders/tasks의 branches와 이름으로 대조.
export function listRepoWorktrees(repoId: string) {
	return api.get<RepoWorktrees>(`/api/repos/${repoId}/worktrees`)
}

// 레포 관리 테이블의 개수 배지용 — list()보다 훨씬 가볍다(per-worktree git 호출 없음).
export function countRepoWorktrees(repoId: string) {
	return api.get<{ count: number }>(`/api/repos/${repoId}/worktrees/count`)
}

// 기존 워크트리를 새로 만들지 않고 그대로 OpenTask 태스크로 입양(Folder+Task+Branch 레코드만 생성).
export function adoptWorktree(repoId: string, branch: string) {
	return api.post<{ ok: true; folderId: string; taskId: string } | { ok: false; error: string }>(`/api/repos/${repoId}/worktrees/adopt`, { branch })
}
