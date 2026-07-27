import { api } from './client'

export interface AppConfig {
	rootPath: string | null
	wtPath: string | null
	branchPrefix: string | null
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

export interface TmuxCheckResult {
	available: boolean
	version: string | null
	error: string | null
}

export function checkTmux() {
	return api.get<TmuxCheckResult>('/api/setup/tmux')
}
