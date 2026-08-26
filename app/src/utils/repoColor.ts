import type { Repo } from '../store/types'

// 레포 "정체성" 컬러 — 상태 신호(violet/blue/green/amber/red, theme.css)와는 다른 축이라 그 5색과
// 겹치지 않는 채도 높은 팔레트를 따로 둔다. 순서가 곧 선택 팔레트 UI 노출 순서.
// 2026-08-25: "선택지가 더 있어야 하고 톤도 더 밝게" 피드백으로 7색 → 12색, 전반적으로 더 밝고
// 쨍한 톤으로 교체(예전 팔레트는 mid-tone이라 흐릿해 보였다).
export const REPO_COLOR_PALETTE = [
	'#14b8a6', // teal
	'#06b6d4', // cyan
	'#3b82f6', // blue
	'#818cf8', // indigo
	'#a78bfa', // violet
	'#e879f9', // fuchsia
	'#f472b6', // pink
	'#fb7185', // rose
	'#fb923c', // orange
	'#facc15', // yellow
	'#a3e635', // lime
	'#4ade80', // green
] as const

// repo.color를 사용자가 명시적으로 고르기 전엔 repo.id를 해시해 팔레트에서 결정적으로 하나를 골라
// 쓴다 — 같은 레포는 재시작해도 항상 같은 색, 서버에 아무것도 저장할 필요 없음.
function hashToIndex(id: string, mod: number) {
	let h = 0
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
	return h % mod
}

export function getRepoColor(repo: Pick<Repo, 'id' | 'color'>): string {
	return repo.color || REPO_COLOR_PALETTE[hashToIndex(repo.id, REPO_COLOR_PALETTE.length)]
}
