export type LinkKind = 'figma' | 'thread' | 'doc' | 'pr'

export const LINK_LABEL: Record<LinkKind, string> = { figma: '피그마', thread: '스레드', doc: '노션', pr: 'PR' }

// Ported from the prototype's detectLink() — figma.com→figma, notion.so|notion.site→doc,
// /pull/ or #123+→pr, else any http(s) URL→thread.
export function detectLink(raw: string): LinkKind | null {
	const v = raw.trim()
	const s = v.toLowerCase()
	if (s.includes('figma.com')) return 'figma'
	if (s.includes('notion.so') || s.includes('notion.site')) return 'doc'
	if (s.includes('/pull/') || /#\d{3,}/.test(v)) return 'pr'
	if (s.startsWith('http')) return 'thread'
	return null
}
