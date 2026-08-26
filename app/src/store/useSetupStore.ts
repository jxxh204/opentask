import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getSetupStatus, postConnector, listEnvVars, createEnvVar, updateEnvVar as apiUpdateEnvVar, removeEnvVar as apiRemoveEnvVar, checkTmux, getOperatorSettings, updateOperatorSettings } from '../api/setup'

export interface ConnectorConfig {
	connected: boolean
	fields: Record<string, string>
}

export interface EnvVar {
	id: string
	key: string
	value: string
	secret: boolean
	masked: boolean
}

export interface SetupState {
	rootPath: string | null
	wtPath: string | null
	branchPrefix: string
	ticketPrefix: string
	operatorName: string
	githubRepo: string | null
	devServerUrl: string | null
	connectors: Record<string, ConnectorConfig>
	env: EnvVar[]
	hydrated: boolean
	tmuxAvailable: boolean | null
	tmuxVersion: string | null
	tmuxError: string | null

	setRootPath(p: string): void
	setWorktreePath(p: string): void
	setBranchPrefix(p: string): void
	setTicketPrefix(p: string): void
	setOperatorName(p: string): void
	/** POST /api/settings — the only path that actually persists operatorName (used by AI review-prompt text) */
	syncOperatorName(name: string): Promise<void>
	setConnector(id: string, patch: Partial<ConnectorConfig>): void
	/** optimistic local update + POST /api/setup/connectors/:id, reconciled from the server's response */
	syncConnector(id: string, fields: Record<string, string>): Promise<void>
	/** pull current AppConfig + env vars from the backend on app load, merging over local/localStorage state */
	hydrate(): Promise<void>
	addEnvVar(): Promise<void>
	updateEnvVar(id: string, patch: Partial<EnvVar>): Promise<void>
	removeEnvVar(id: string): Promise<void>
	checkTmuxAvailable(): Promise<void>
	reset(): void
}

// Persisted to localStorage['openrm.setup'] as an offline-first cache (same
// key the original prototype used) — the SQLite-backed /api/setup/* routes
// (Phase 2b) are the durable source of truth once reachable; `hydrate()`
// reconciles server state over whatever localStorage had on boot.
export const useSetupStore = create<SetupState>()(
	persist(
		(set, get) => ({
			rootPath: null,
			wtPath: null,
			branchPrefix: '',
			ticketPrefix: '',
			operatorName: '',
			githubRepo: null,
			devServerUrl: null,
			connectors: {},
			env: [],
			hydrated: false,
			tmuxAvailable: null,
			tmuxVersion: null,
			tmuxError: null,

			setRootPath: (p) => set({ rootPath: p }),
			setWorktreePath: (p) => set({ wtPath: p }),
			setBranchPrefix: (p) => set({ branchPrefix: p }),
			setTicketPrefix: (p) => set({ ticketPrefix: p }),
			setOperatorName: (p) => set({ operatorName: p }),
			syncOperatorName: async (name) => {
				set({ operatorName: name }) // optimistic
				try {
					const res = await updateOperatorSettings({ operatorName: name })
					set({ operatorName: res.settings.operatorName })
				} catch (e) {
					console.warn('[setup] failed to sync operatorName to backend:', e)
				}
			},
			setConnector: (id, patch) =>
				set((s) => {
					const cur = s.connectors[id] ?? { connected: false, fields: {} }
					return {
						connectors: {
							...s.connectors,
							[id]: {
								connected: patch.connected ?? cur.connected,
								fields: patch.fields ? { ...cur.fields, ...patch.fields } : cur.fields,
							},
						},
					}
				}),

			syncConnector: async (id, fields) => {
				get().setConnector(id, { fields }) // optimistic — UI reflects the typed values immediately
				try {
					const res = await postConnector(id, fields)
					set((s) => ({
						rootPath: res.appConfig.rootPath,
						wtPath: res.appConfig.wtPath,
						branchPrefix: res.appConfig.branchPrefix ?? s.branchPrefix,
						ticketPrefix: res.appConfig.ticketPrefix ?? s.ticketPrefix,
						githubRepo: res.appConfig.githubRepo,
						devServerUrl: res.appConfig.devServerUrl,
						connectors: { ...s.connectors, [id]: { connected: true, fields } },
					}))
				} catch (e) {
					// local-only fallback: mark connected so the step doesn't block the user offline,
					// but leave a trace in the console since this silently diverges from server truth.
					console.warn(`[setup] failed to sync connector "${id}" to backend, keeping local-only:`, e)
					get().setConnector(id, { connected: true })
				}
			},

			hydrate: async () => {
				try {
					const [status, serverEnv, operatorSettings] = await Promise.all([getSetupStatus(), listEnvVars(), getOperatorSettings()])
					set({
						rootPath: status.appConfig.rootPath,
						wtPath: status.appConfig.wtPath,
						branchPrefix: status.appConfig.branchPrefix ?? '',
						ticketPrefix: status.appConfig.ticketPrefix ?? '',
						githubRepo: status.appConfig.githubRepo,
						devServerUrl: status.appConfig.devServerUrl,
						operatorName: operatorSettings.settings.operatorName ?? '',
						env: serverEnv.map((e) => ({ id: e.id, key: e.key, value: e.value, secret: !!e.secret, masked: !!e.secret })),
						hydrated: true,
					})
				} catch (e) {
					console.warn('[setup] failed to hydrate from backend, using local/offline state:', e)
					set({ hydrated: true })
				}
				get().checkTmuxAvailable()
			},

			checkTmuxAvailable: async () => {
				try {
					const r = await checkTmux()
					set({ tmuxAvailable: r.available, tmuxVersion: r.version, tmuxError: r.error })
				} catch (e) {
					set({ tmuxAvailable: false, tmuxVersion: null, tmuxError: e instanceof Error ? e.message : String(e) })
				}
			},

			addEnvVar: async () => {
				try {
					const row = await createEnvVar({ key: '', value: '', secret: false })
					set((s) => ({ env: [...s.env, { id: row.id, key: row.key, value: row.value, secret: !!row.secret, masked: false }] }))
				} catch (e) {
					console.warn('[setup] failed to create env var on backend:', e)
				}
			},
			updateEnvVar: async (id, patch) => {
				set((s) => ({ env: s.env.map((e) => (e.id === id ? { ...e, ...patch } : e)) })) // optimistic
				const { masked: _masked, ...serverPatch } = patch
				if (Object.keys(serverPatch).length === 0) return
				try {
					await apiUpdateEnvVar(id, serverPatch)
				} catch (e) {
					console.warn(`[setup] failed to update env var ${id} on backend:`, e)
				}
			},
			removeEnvVar: async (id) => {
				set((s) => ({ env: s.env.filter((e) => e.id !== id) })) // optimistic
				try {
					await apiRemoveEnvVar(id)
				} catch (e) {
					console.warn(`[setup] failed to remove env var ${id} on backend:`, e)
				}
			},

			reset: () => set({ rootPath: null, wtPath: null, branchPrefix: '', githubRepo: null, devServerUrl: null, connectors: {} }),
			// keep operatorName/env across reset — they aren't gated onboarding fields
		}),
		{
			name: 'openrm.setup',
			partialize: (s) => ({ rootPath: s.rootPath, wtPath: s.wtPath, branchPrefix: s.branchPrefix, operatorName: s.operatorName, githubRepo: s.githubRepo, devServerUrl: s.devServerUrl, connectors: s.connectors }),
			// dispatch the legacy 'openrm:setup' event on every write so
			// ActivityBar/ContextPanel-style listeners elsewhere stay in sync
			// even if they haven't been migrated to the store hook yet.
			onRehydrateStorage: () => () => {
				try {
					window.dispatchEvent(new Event('openrm:setup'))
				} catch {}
			},
		},
	),
)

export function isSetupConfigured(s: Pick<SetupState, 'rootPath' | 'wtPath'>) {
	return !!s.rootPath && !!s.wtPath
}

useSetupStore.subscribe(() => {
	try {
		window.dispatchEvent(new Event('openrm:setup'))
	} catch {}
})
