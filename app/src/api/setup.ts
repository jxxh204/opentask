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

export function postConnector(id: string, fields: Record<string, string>) {
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
