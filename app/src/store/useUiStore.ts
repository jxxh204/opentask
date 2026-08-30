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

// useHolidayStore.ts의 detectDefaultCountry()와 같은 스타일 — OS 언어 설정(navigator.language의
// 언어 서브태그)이 한국어가 아니면 최초 기본값을 'en'으로 잡는다. persist가 저장된 값이 있으면
// 이 함수 자체를 안 쓰므로, 이미 한 번이라도 설정에서 바꾼 사용자에게는 영향이 없다.
function detectDefaultLang(): Lang {
	try {
		const langs = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []
		for (const l of langs) {
			if (l) return l.toLowerCase().startsWith('ko') ? 'ko' : 'en'
		}
	} catch {
		/* navigator 접근 실패 — 아래 폴백 */
	}
	return 'ko'
}

export const useUiStore = create<UiState>()(
	persist(
		(set) => ({
			theme: 'system',
			lang: detectDefaultLang(),
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
