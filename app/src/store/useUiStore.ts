import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'
export type Lang = 'ko' | 'en'

export interface UiState {
	theme: Theme
	lang: Lang
	setTheme(t: Theme): void
	setLang(l: Lang): void
}

export const useUiStore = create<UiState>()(
	persist(
		(set) => ({
			theme: 'system',
			lang: 'ko',
			setTheme: (t) => set({ theme: t }),
			setLang: (l) => set({ lang: l }),
		}),
		{ name: 'openrm.ui' },
	),
)

/** :root[data-theme]에 반영 — 'system'이면 속성을 아예 지워서 theme.css의 prefers-color-scheme 분기가 그대로 먹게 한다. */
export function applyTheme(theme: Theme) {
	if (theme === 'system') document.documentElement.removeAttribute('data-theme')
	else document.documentElement.setAttribute('data-theme', theme)
}
