export type LinkKind = 'figma' | 'thread' | 'doc' | 'pr'

export const LINK_LABEL: Record<LinkKind, string> = { figma: '피그마', thread: '스레드', doc: '노션', pr: 'PR' }

// Ported from the prototype's detectLink() — figma.com→figma, notion.so|notion.site→doc,
// /pull/ or #123+→pr, else any http(s) URL→thread.
export function detectLink(raw: string): LinkKind | null {
	const v = raw.trim()
	const s = v.toLowerCase()
	if (s.includes('figma.com')) return 'figma'
	// notion.so/notion.site뿐 아니라 워크스페이스 커스텀 도메인 등 노션 URL 변형이 더 있어서
	// 접미사 두 개만 정확히 맞추지 않고 "notion"이 포함되면 노션으로 본다("노션 링크인데
	// 스레드 링크로 적혀있어" — 접미사만 보던 예전 체크가 놓친 케이스가 있었음).
	if (s.includes('notion')) return 'doc'
	if (s.includes('/pull/') || /#\d{3,}/.test(v)) return 'pr'
	if (s.startsWith('http')) return 'thread'
	return null
}
