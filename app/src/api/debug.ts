import { api } from './client'
import type { ElementInfoRow, NetworkRow, ConsoleEntry, ThreadPhase } from '../store/useDebugStore'

export interface DebugSessionResult {
	ok: boolean
	id?: string
	url?: string
	device?: string
	taskId?: string | null
	branchId?: string | null
	error?: string
}

export interface ServerThread {
	id: string
	cmd: string
	ellabel: string
	phase: ThreadPhase
	log: string
	diff: string
	reply: string
	files: string[]
}

export function createDebugSession(input: { taskId: string | null; branchId: string | null; url: string; device: 'pc' | 'webview' }) {
	return api.post<DebugSessionResult>('/api/debug/sessions', input)
}
export function closeDebugSession(id: string) {
	return api.delete<{ ok: boolean }>(`/api/debug/sessions/${id}`)
}
export function screenshotUrl(id: string) {
	// consumed as an <img src>, not via api.get — the browser fetches this directly (avoids
	// base64-round-tripping a JPEG through JSON on every poll tick)
	return `/api/debug/sessions/${id}/screenshot?t=${Date.now()}`
}
export function inspectAt(id: string, x: number, y: number) {
	return api.post<{ ok: boolean; rows?: ElementInfoRow[]; error?: string }>(`/api/debug/sessions/${id}/inspect`, { x, y })
}
export function listNetwork(id: string) {
	return api.get<{ ok: boolean; network: NetworkRow[] }>(`/api/debug/sessions/${id}/network`)
}
export function listConsole(id: string) {
	return api.get<{ ok: boolean; console: ConsoleEntry[] }>(`/api/debug/sessions/${id}/console`)
}
export function sendThread(id: string, cmd: string, attach: Record<string, unknown>) {
	return api.post<{ ok: boolean; thread?: ServerThread; error?: string }>(`/api/debug/sessions/${id}/threads`, { cmd, attach })
}
export function listThreads(id: string) {
	return api.get<{ ok: boolean; threads: ServerThread[] }>(`/api/debug/sessions/${id}/threads`)
}
export function sendFollowUp(threadId: string, text: string) {
	return api.post<{ ok: boolean; thread?: ServerThread; error?: string }>(`/api/debug/threads/${threadId}/followup`, { text })
}
