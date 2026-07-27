export interface DbNode {
	id: string
	kind: 'table' | 'fn'
	name: string
	ko: string
	meta: string
}
export interface DbGroup {
	label: string
	kind: 'table' | 'fn'
	nodes: DbNode[]
}
export interface ApiNode {
	id: string
	name: string
	dbRefs: string[]
}
export interface RouteNode {
	id: string
	kind: 'page' | 'route'
	name: string
	apiRefs: string[]
	meta: string
}
export interface ArchGraph {
	dbGroups: DbGroup[]
	apiNodes: ApiNode[]
	routeNodes: RouteNode[]
}

// 아무 것도 연결하지 않았을 때 보여줄 예시 그래프 — PRD 프로토타입의 데모 도메인(가계부 앱)을 그대로 사용.
// 실제 DB/API/라우트에 연결하면 이 fixture는 실제 introspection 결과로 교체된다(Phase 5b).
export const FIXTURE_GRAPH: ArchGraph = {
	dbGroups: [
		{
			label: 'BUDGETS',
			kind: 'table',
			nodes: [
				{ id: 'transactions', kind: 'table', name: 'transactions', ko: '거래 내역', meta: '18개 컬럼' },
				{ id: 'fixed_expenses', kind: 'table', name: 'fixed_expenses', ko: '고정 지출', meta: '14개 컬럼' },
			],
		},
		{
			label: 'FEEDBACK',
			kind: 'table',
			nodes: [{ id: 'feedback', kind: 'table', name: 'feedback', ko: '문의', meta: '8개 컬럼' }],
		},
		{
			label: 'FIXED-EXPENSES',
			kind: 'fn',
			nodes: [{ id: 'record_fixed_expense', kind: 'fn', name: 'record_fixed_expense', ko: '', meta: 'fixed_expenses, transactions, household_members' }],
		},
		{
			label: 'HOUSEHOLD',
			kind: 'table',
			nodes: [
				{ id: 'profiles', kind: 'table', name: 'profiles', ko: '프로필', meta: '4개 컬럼' },
				{ id: 'households', kind: 'table', name: 'households', ko: '가구', meta: '5개 컬럼' },
				{ id: 'household_members', kind: 'table', name: 'household_members', ko: '가구 구성원', meta: '6개 컬럼' },
			],
		},
	],
	apiNodes: [
		{ id: 'a:app-shell', name: 'app-shell', dbRefs: [] },
		{ id: 'a:auth', name: 'auth', dbRefs: [] },
		{ id: 'a:budgets', name: 'budgets', dbRefs: ['transactions', 'fixed_expenses'] },
		{ id: 'a:changelog', name: 'changelog', dbRefs: [] },
		{ id: 'a:dev-tools', name: 'dev-tools', dbRefs: [] },
		{ id: 'a:feedback', name: 'feedback', dbRefs: ['feedback'] },
		{ id: 'a:fixed-expenses', name: 'fixed-expenses', dbRefs: ['fixed_expenses', 'record_fixed_expense'] },
		{ id: 'a:gamification', name: 'gamification', dbRefs: ['transactions'] },
		{ id: 'a:home', name: 'home', dbRefs: [] },
	],
	routeNodes: [
		{ id: 'p:/', kind: 'page', name: '/', apiRefs: ['a:app-shell', 'a:auth', 'a:budgets', 'a:gamification', 'a:home', 'a:changelog', 'a:dev-tools'], meta: 'household, budgets, transactions, home, auth, gamification, app-shell' },
		{ id: 'p:cron', kind: 'route', name: '/api/cron/fixed-expenses', apiRefs: [], meta: '도메인 연결 없음' },
		{ id: 'p:devlogin', kind: 'route', name: '/api/dev-login', apiRefs: [], meta: '도메인 연결 없음' },
		{ id: 'p:qtiming', kind: 'route', name: '/api/dev/query-timing', apiRefs: ['a:dev-tools'], meta: 'dev-tools' },
		{ id: 'p:health', kind: 'route', name: '/api/health', apiRefs: ['a:dev-tools'], meta: 'dev-tools' },
		{ id: 'p:authcb', kind: 'route', name: '/auth/callback', apiRefs: [], meta: '도메인 연결 없음' },
		{ id: 'p:/budgets', kind: 'page', name: '/budgets', apiRefs: ['a:budgets', 'a:fixed-expenses', 'a:gamification', 'a:auth', 'a:app-shell'], meta: 'budgets, fixed-expenses, gamification, auth, app-shell' },
		{ id: 'p:/dev', kind: 'page', name: '/dev', apiRefs: ['a:dev-tools', 'a:changelog'], meta: 'dev-tools, changelog' },
	],
}
