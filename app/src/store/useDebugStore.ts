import { create } from 'zustand'
import * as DebugApi from '../api/debug'

// Phase 4a built this against fixture data (setTimeout-simulated timeline,
// matching 디버깅.dc.html's own `send()`). Phase 4b (this file, now) wires a
// real Playwright-backed session when `startSession()` is called — real live
// screenshot polling, real element inspection, real network/console capture,
// real dispatch to the task's orchestration session. The FIXTURE_* consts
// below remain as the pre-connect placeholder shown before a session starts.

export type DrawerTab = 'element' | 'network' | 'console'
export type ThreadPhase = 'working' | 'reloading' | 'done'

export interface ElementInfoRow {
	key: string
	label: string
	value: string
	accent?: boolean
}

export interface NetworkField {
	key: string
	label: string
	value: string
}

export interface NetworkRow {
	id: string
	method: string
	url: string
	status: number
	ms: number
	mswOn: boolean
	reqSize: string
	resSize: string
	type: string
	fields: NetworkField[]
}

export interface ConsoleEntry {
	id: string
	title: string
	body: string
}

export interface Thread {
	id: string
	cmd: string
	ellabel: string
	phase: ThreadPhase
	log: string
	diff: string
	reply: string
	files: string[]
}

const FIXTURE_ELEMENT_INFO: ElementInfoRow[] = [
	{ key: 'selector', label: 'SELECTOR', value: '(요소를 지목하면 여기 표시됩니다)', accent: true },
	{ key: 'component', label: 'COMPONENT', value: '—' },
	{ key: 'box', label: 'BOX', value: '—' },
	{ key: 'type', label: 'TYPOGRAPHY', value: '—' },
	{ key: 'computed', label: 'COMPUTED', value: '—' },
	{ key: 'state', label: 'STATE / PROPS', value: '—' },
]

let uid = 0
let networkConsolePoll: ReturnType<typeof setInterval> | null = null
let threadPoll: ReturnType<typeof setInterval> | null = null

function clearPolls() {
	if (networkConsolePoll) clearInterval(networkConsolePoll)
	if (threadPoll) clearInterval(threadPoll)
	networkConsolePoll = null
	threadPoll = null
}

export interface DebugState {
	target: { task: string; worktree: string; server: string }
	taskId: string | null
	branchId: string | null
	devUrl: string
	ip: string
	port: string
	copied: boolean
	device: 'pc' | 'webview'
	route: string
	selecting: boolean
	drawerOpen: boolean
	drawerTab: DrawerTab
	elementInfo: ElementInfoRow[]
	network: NetworkRow[]
	consoleErrors: ConsoleEntry[]
	netHover: string | null
	netOpen: Record<string, boolean>
	attach: Record<string, boolean>
	cmd: string
	threads: Thread[]
	hmr: boolean
	modalThreadId: string | null
	modalTab: 'reply' | 'diff'
	followUp: string

	sessionId: string | null
	connecting: boolean
	sessionError: string | null
	screenshotNonce: number

	startSession(taskId: string | null, branchId: string | null, url: string, device: 'pc' | 'webview'): Promise<void>
	stopSession(): Promise<void>
	inspectAtCoord(x: number, y: number): Promise<void>

	setDevice(d: 'pc' | 'webview'): void
	toggleSelect(): void
	openDrawerTab(tab: DrawerTab): void
	closeDrawer(): void
	copyIp(): void
	toggleAttach(key: string): void
	setNetHover(id: string | null): void
	toggleNetOpen(id: string): void
	setCmd(v: string): void
	send(): void
	openThread(id: string): void
	closeModal(): void
	setModalTab(tab: 'reply' | 'diff'): void
	setFollowUp(v: string): void
	sendFollowUp(): void
}

export const useDebugStore = create<DebugState>()((set, get) => ({
	target: { task: '(세션 시작 전)', worktree: '—', server: '—' },
	taskId: null,
	branchId: null,
	devUrl: '',
	ip: '192.168.0.42',
	port: ':5040',
	copied: false,
	device: 'pc',
	route: '',
	selecting: true,
	drawerOpen: false,
	drawerTab: 'element',
	elementInfo: FIXTURE_ELEMENT_INFO,
	network: [],
	consoleErrors: [],
	netHover: null,
	netOpen: {},
	attach: {},
	cmd: '',
	threads: [],
	hmr: false,
	modalThreadId: null,
	modalTab: 'reply',
	followUp: '',

	sessionId: null,
	connecting: false,
	sessionError: null,
	screenshotNonce: 0,

	startSession: async (taskId, branchId, url, device) => {
		set({ connecting: true, sessionError: null })
		try {
			const res = await DebugApi.createDebugSession({ taskId, branchId, url, device })
			if (!res.ok || !res.id) {
				set({ connecting: false, sessionError: res.error || '세션 시작 실패' })
				return
			}
			set({
				connecting: false,
				sessionId: res.id,
				taskId,
				branchId,
				devUrl: url,
				device,
				target: { task: taskId || '(태스크 미지정)', worktree: branchId || '—', server: url },
			})
			clearPolls()
			const tick = () => set((s) => ({ screenshotNonce: s.screenshotNonce + 1 }))
			networkConsolePoll = setInterval(async () => {
				const sid = get().sessionId
				if (!sid) return
				tick()
				const [net, cons] = await Promise.all([DebugApi.listNetwork(sid).catch(() => null), DebugApi.listConsole(sid).catch(() => null)])
				if (net?.ok) set({ network: net.network })
				if (cons?.ok) set({ consoleErrors: cons.console })
			}, 1000)
			threadPoll = setInterval(async () => {
				const sid = get().sessionId
				if (!sid) return
				const r = await DebugApi.listThreads(sid).catch(() => null)
				if (r?.ok) {
					set({ threads: r.threads, hmr: r.threads.some((t) => t.phase === 'reloading') })
				}
			}, 1500)
		} catch (e) {
			set({ connecting: false, sessionError: e instanceof Error ? e.message : String(e) })
		}
	},

	stopSession: async () => {
		const id = get().sessionId
		clearPolls()
		set({ sessionId: null, threads: [], network: [], consoleErrors: [], elementInfo: FIXTURE_ELEMENT_INFO })
		if (id) await DebugApi.closeDebugSession(id).catch(() => {})
	},

	inspectAtCoord: async (x, y) => {
		const id = get().sessionId
		if (!id) return
		const r = await DebugApi.inspectAt(id, x, y).catch((e) => ({ ok: false, error: String(e) }) as const)
		if (r.ok && 'rows' in r && r.rows) set({ elementInfo: r.rows })
		else set({ elementInfo: [{ key: 'error', label: 'ERROR', value: ('error' in r && r.error) || '지목 실패', accent: true }] })
	},

	setDevice: (d) => set({ device: d }),
	toggleSelect: () => set((s) => ({ selecting: !s.selecting })),
	openDrawerTab: (tab) => set({ drawerTab: tab, drawerOpen: true }),
	closeDrawer: () => set({ drawerOpen: false }),
	copyIp: () => {
		try {
			navigator.clipboard?.writeText(get().ip + get().port)
		} catch {
			/* clipboard unavailable — non-fatal */
		}
		set({ copied: true })
		setTimeout(() => set({ copied: false }), 1400)
	},
	toggleAttach: (key) => set((s) => ({ attach: { ...s.attach, [key]: !s.attach[key] } })),
	setNetHover: (id) => set({ netHover: id }),
	toggleNetOpen: (id) => set((s) => ({ netOpen: { ...s.netOpen, [id]: !s.netOpen[id] } })),
	setCmd: (v) => set({ cmd: v }),

	send: () => {
		const s = get()
		const cmd = s.cmd.trim()
		const keys = Object.keys(s.attach).filter((k) => s.attach[k])
		if (!cmd && keys.length === 0) return
		set({ cmd: '' })

		if (s.sessionId) {
			// real dispatch — reuses the same session-resolution/Actuator path as
			// Sessions' PR-review "적용" action; phase transitions come from polling
			// listThreads (server-side heuristic reload watcher), not local timers.
			const attachPayload: Record<string, unknown> = {}
			for (const k of keys) attachPayload[k] = true
			DebugApi.sendThread(s.sessionId, cmd, attachPayload)
				.then((r) => {
					if (!r.ok) set({ sessionError: r.error || '전송 실패' })
					else if (r.thread) set((st) => ({ threads: [...st.threads.filter((t) => t.id !== r.thread!.id), r.thread as Thread] }))
				})
				.catch((e) => set({ sessionError: e instanceof Error ? e.message : String(e) }))
			return
		}

		// no live session yet — keep the old fixture-style simulated timeline so the
		// UI is still click-through-able before a real target is connected.
		const id = 'th' + Date.now() + '-' + ++uid
		const thread: Thread = { id, cmd: cmd || '(첨부만 전송)', ellabel: 'button.primary-action', phase: 'working', log: '컨텍스트 수신 · 파일 탐색 중… (세션 미연결 — 시뮬레이션)', diff: '', reply: '', files: [] }
		set((st) => ({ threads: [...st.threads, thread] }))
		const upd = (patch: Partial<Thread>) => set((st) => ({ threads: st.threads.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
		setTimeout(() => upd({ log: '(시뮬레이션) 수정 중…' }), 1100)
		setTimeout(() => {
			upd({ phase: 'reloading', log: '(시뮬레이션) HMR 갱신' })
			set({ hmr: true })
		}, 2400)
		setTimeout(() => set({ hmr: false }), 3100)
		setTimeout(() => {
			upd({ phase: 'done', log: '(시뮬레이션) 완료', diff: '', reply: '실제 세션이 연결되지 않아 시뮬레이션으로 표시했습니다. 상단에서 디버그 세션을 시작하세요.', files: [] })
		}, 3300)
	},

	openThread: (id) => set({ modalThreadId: id, modalTab: 'reply' }),
	closeModal: () => set({ modalThreadId: null }),
	setModalTab: (tab) => set({ modalTab: tab }),
	setFollowUp: (v) => set({ followUp: v }),
	sendFollowUp: () => {
		const s = get()
		const v = s.followUp.trim()
		const id = s.modalThreadId
		if (!v || !id) return
		set({ followUp: '' })
		if (s.sessionId) {
			DebugApi.sendFollowUp(id, v)
				.then((r) => {
					if (!r.ok) set({ sessionError: r.error || '전송 실패' })
					else if (r.thread) set((st) => ({ threads: st.threads.map((t) => (t.id === id ? (r.thread as Thread) : t)) }))
				})
				.catch((e) => set({ sessionError: e instanceof Error ? e.message : String(e) }))
			return
		}
		const upd = (patch: Partial<Thread>) => set((st) => ({ threads: st.threads.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
		upd({ phase: 'working', log: '(시뮬레이션) 후속 지시 수신…' })
		setTimeout(() => upd({ phase: 'done', log: '(시뮬레이션) 완료' }), 1600)
	},
}))
