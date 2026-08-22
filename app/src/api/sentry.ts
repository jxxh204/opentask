import { api } from './client'

export interface SentryStatus {
	ok: boolean
	configured: boolean
	org: string
	project: string
	query: string
	identifier: string
	kind: string
	tokenMasked: string
}

export function getSentryStatus() {
	return api.get<SentryStatus>('/api/sentry/status')
}

export function setSentryConfig(patch: { sentryToken?: string; sentryOrg?: string; sentryProject?: string }) {
	return api.post<SentryStatus>('/api/sentry/config', patch)
}
