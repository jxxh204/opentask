import { api } from './client'

export interface MonitorFinding {
	key: string
	kind: 'ci' | 'review' | 'issue' | 'sentry'
	icon: string
	level: 'bad' | 'warn' | 'good' | 'info'
	status: 'open' | 'resolved' | 'regression'
	title: string
	detail: string
	url: string | null
	repo: string
	ticket: string | null
	number: number | null
	firstSeen: number
	lastSeen: number
	resolvedAt: number | null
	recurred: boolean
	pr: { number: number; repo: string; state: string; url: string; draft: boolean } | null
}

export interface MonitorState {
	running: boolean
	intervalMs: number
	lastPoll: number | null
	lastError: string | null
	counts: { unresolved: number; regression: number; withPr: number; resolved: number }
	findings: MonitorFinding[]
}

export interface MonitorHealth {
	ok: boolean
	prod: { status: string | null; uptimePct: number | null }
	errorRate1h: number | null
	deploysToday: number | null
	prsAwaitingReview: number | null
	sentry: { configured: boolean; recentIssues1h: number | null }
	builtAt: string
}

export interface ConnectorCard {
	id: string
	label: string
	connected: boolean
	configured?: boolean
	url?: string
	lastStatus?: number | null
	checkedAt?: number
}

export interface DispatchResult {
	ok: boolean
	key?: string
	jobId?: string
	result?: { summary: string; rootCause: string | null; suggestion: string | null; confidence: string | null }
	error?: string
}

export function getMonitorState() {
	return api.get<MonitorState>('/api/monitor')
}
export function getMonitorHealth() {
	return api.get<MonitorHealth>('/api/monitor/health')
}
export function getMonitorConnectors() {
	return api.get<{ ok: boolean; connectors: ConnectorCard[] }>('/api/monitor/connectors').then((r) => r.connectors)
}
export function dispatchMonitorAction(key: string, instruction: string) {
	return api.post<DispatchResult>('/api/monitor/actions/dispatch', { key, instruction })
}

// AWS MFA 세션 — 읽기전용 STS 호출(get-session-token/get-caller-identity)만 사용 (server/aws.cjs 참고)
export interface AwsMfaStatus {
	valid: boolean
	error: string | null
	account: string
	arn: string
	serial: string | null
	hasSerial: boolean
	expiration: string | null
	remainingMs: number | null
	renewedAt: number | null
}

export function getAwsMfaStatus(force?: boolean) {
	return api.get<AwsMfaStatus>(`/api/monitor/aws${force ? '?force=1' : ''}`)
}
export function renewAwsMfa(code: string) {
	return api.post<AwsMfaStatus & { ok: boolean; error?: string }>('/api/monitor/aws/mfa', { code })
}
