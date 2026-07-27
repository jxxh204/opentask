// Single source of nav metadata — replaces the prototype's separate inline
// NAV/PANEL consts duplicated per concern. One entry drives the activity bar,
// the context panel, and the route table (App.tsx imports ROUTES from here).

export interface NavItem {
	id: string
	route: string
	label: string
	group: string
	/** inline SVG path data, viewBox 0 0 24 24 (matches prototype's icon style) */
	icon: string
}

export interface PanelSection {
	header?: string
	name?: string
	count?: string
}

export const NAV_GROUPS = ['핵심 작업', '모니터링', '분석 · 참조'] as const

export const NAV_ITEMS: NavItem[] = [
	{
		id: 'sessions',
		route: '/sessions',
		label: '개발실',
		group: '핵심 작업',
		icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9l-2 3 2 3M16 9l2 3-2 3"/>',
	},
	{
		id: 'debug',
		route: '/debug',
		label: '디버깅',
		group: '핵심 작업',
		icon: '<rect x="8" y="6" width="8" height="12" rx="4"/><path d="M12 2v3M5 9H2M5 15H2M22 9h-3M22 15h-3M8 4 6 2M16 4l2-2"/>',
	},
	{
		id: 'github',
		route: '/github',
		label: 'GitHub',
		group: '핵심 작업',
		icon: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7M18 15.5V11a4 4 0 0 0-4-4h-3"/>',
	},
	{
		id: 'monitor',
		route: '/monitor',
		label: '모니터',
		group: '모니터링',
		icon: '<path d="M3 12h4l2 6 4-14 2 8h6"/>',
	},
	{
		id: 'architecture',
		route: '/architecture',
		label: '아키텍처',
		group: '분석 · 참조',
		icon: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5 5.5 17M12 11.5 18.5 17"/>',
	},
]

/** bottom-pinned, not part of the main icon rail list (matches shell prototype) */
export const SETUP_ITEM: NavItem = {
	id: 'setup',
	route: '/setup',
	label: '초기 설정',
	group: '',
	icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
}

/** placeholder panel content per page — pages wire in real data in their own phase */
export const PANEL_ITEMS: Record<string, PanelSection[]> = {
	sessions: [{ header: '폴더' }, { header: '보기' }, { name: '미분류' }],
	debug: [{ header: '대상' }, { name: '로컬 · localhost' }, { header: '인스펙터' }, { name: '요소' }, { name: '네트워크' }, { name: '콘솔' }],
	github: [{ header: '작업' }, { name: '내 PR' }, { name: '리뷰 요청' }, { name: '이슈' }, { header: '저장소' }],
	monitor: [{ header: '루프' }, { name: '운영 Claude' }, { name: 'PR Claude' }, { header: '이벤트' }, { name: '전체' }, { name: '경고만' }],
	architecture: [{ header: '레이어' }, { name: 'DB' }, { name: 'API' }, { name: 'Next.js' }, { header: '보기' }, { name: '그래프' }, { name: '설정 모드' }],
	setup: [{ header: '스텝' }, { name: '프로젝트 · 워크트리' }, { name: 'GitHub 연결' }, { name: '커넥터' }, { name: '환경변수' }],
}
