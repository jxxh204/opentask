import { api } from './client'

export interface AppConfig {
	rootPath: string | null
	wtPath: string | null
	branchPrefix: string | null
	ticketPrefix: string | null
	operatorName: string
	githubRepo: string | null
	githubRepos: string[]
	devServerUrl: string | null
	webviewPort: number | string | null
	dbSchema: string
	apiRoot: string | null
	apiBaseUrl: string | null
	nextRoot: string | null
	nextPort: number | string | null
	nextRouterMode: 'app' | 'pages'
	sentryOrg: string | null
	sentryProject: string | null
	awsDeployWebhookUrl: string | null
	vitalsEndpoint: string | null
	slackAlertChannel: string | null
	notionBacklogDb: string | null
	notionBacklogAssignee: string | null
	notionBacklogService: string | null
	notionBacklogPlatform: string | null
	deployRepo: string | null
	deployBase: string | null
	githubOAuthClientId: string | null
	// "고스티도 tmux도 설정 토글로 제공해야해. 기본은 터미널이고" — 둘 다 기본 꺼짐(§ store/settings.cjs).
	terminalGhostty: boolean
	terminalTmux: boolean
}

// GitHub 연동 — ① gh CLI 위임 ② OAuth Device Flow (server/githubConnect.cjs)
export interface GhCliStatus {
	ok: boolean
	loggedIn: boolean
	username?: string
}
export interface GithubOAuthStart {
	ok: boolean
	userCode?: string
	verificationUri?: string
	interval?: number
	expiresIn?: number
	error?: string
}
export interface GithubOAuthPoll {
	ok: boolean
	done?: boolean
	slowDown?: boolean
	username?: string
	error?: string
}

export function getGhCliStatus() {
	return api.get<GhCliStatus>('/api/setup/github/gh-status')
}
export function startGithubOAuth() {
	return api.post<GithubOAuthStart>('/api/setup/github/oauth/start')
}
export function pollGithubOAuth() {
	return api.post<GithubOAuthPoll>('/api/setup/github/oauth/poll')
}

export interface OperatorSettings {
	operatorName: string
	// server/settings.cjs MODEL_POLICY와 같은 형태 — 액션명 → 실제 claude 모델 id.
	// 얕은 병합(Settings.save)이라 patch로 보낼 땐 항상 전체 객체를 다시 보내야 한다.
	modelPolicy?: Record<string, string>
	// "하이브마인드 전체 운영 모드" — 켜면 15분마다 하이브마인드 자신에게 전체 태스크 그래프 점검
	// 프롬프트를 자동으로 넣는다(§ server/control.cjs runOpsModeTick). 기본 꺼짐.
	opsMode?: boolean
}

export function getOperatorSettings() {
	return api.get<{ settings: OperatorSettings }>('/api/settings')
}

export function updateOperatorSettings(patch: Partial<OperatorSettings>) {
	return api.post<{ settings: OperatorSettings }>('/api/settings', patch)
}

export interface SetupStatus {
	appConfig: AppConfig
	secretKeys: string[]
	configured: boolean
}

export interface ServerEnvVar {
	id: string
	key: string
	value: string
	secret: number | boolean
	order_idx: number
	created_at: number
}

export interface FsResolveResult {
	exists: boolean
	isDirectory: boolean
	isGitRepo: boolean
	gitRoot: string | null
	existingWorktrees: { path: string; branch: string | null }[]
}

export function getSetupStatus() {
	return api.get<SetupStatus>('/api/setup/status')
}

// "terminal" 커넥터(ghostty/tmux)는 boolean 필드라 나머지 커넥터의 string 전용 타입을 그대로 못
// 쓴다 — 백엔드는 이미 타입 무관하게 그대로 저장하므로(§ index.cjs SETUP_CONNECTOR_MAP) 타입만 넓힌다.
export function postConnector(id: string, fields: Record<string, string | boolean>) {
	return api.post<SetupStatus & { skipped: string[] }>(`/api/setup/connectors/${encodeURIComponent(id)}`, { fields })
}

export function listEnvVars() {
	return api.get<ServerEnvVar[]>('/api/setup/env')
}

export function createEnvVar(input: { key: string; value: string; secret: boolean }) {
	return api.post<ServerEnvVar>('/api/setup/env', input)
}

export function updateEnvVar(id: string, patch: Partial<{ key: string; value: string; secret: boolean }>) {
	return api.patch<ServerEnvVar>(`/api/setup/env/${encodeURIComponent(id)}`, patch)
}

export function removeEnvVar(id: string) {
	return api.delete<{ ok: boolean }>(`/api/setup/env/${encodeURIComponent(id)}`)
}

export function resolveFsPath(path: string) {
	return api.get<FsResolveResult>(`/api/setup/fs/resolve?path=${encodeURIComponent(path)}`)
}

export interface FsListResult {
	ok: boolean
	path?: string
	parent?: string | null
	entries?: { name: string; path: string }[]
	error?: string
}

export function listFs(path: string) {
	return api.get<FsListResult>(`/api/setup/fs/list?path=${encodeURIComponent(path)}`)
}

export interface TmuxCheckResult {
	available: boolean
	version: string | null
	error: string | null
}

export function checkTmux() {
	return api.get<TmuxCheckResult>('/api/setup/tmux')
}

// "둘 다 안 깔려있는 사람은 비활성화하고 경고표기" — 위 checkTmux()/TmuxCheckResult는 옛 tmux
// 아키텍처 시절 온보딩용으로 지금은 하드코딩 stub(§ term.cjs checkAvailable)이라 재사용하지 않는다.
// 설정 화면의 실제 disabled 판단은 이 값을 본다.
export interface TerminalCapabilities {
	tmux: boolean
	ghostty: boolean
}
export function getTerminalCapabilities() {
	return api.get<TerminalCapabilities>('/api/setup/terminal-capabilities')
}
