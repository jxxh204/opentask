import { useUiStore } from '../../store/useUiStore'
import type { Lang } from '../../store/useUiStore'

// 설정 > "내부 용어 언어" 토글(§SettingsModal) — DICT는 `dicts/*.ts` 샤드들을 import.meta.glob으로
// 자동 병합한 Record<한글 원문, 영어>다. 새 번역을 추가할 땐 담당 도메인의 dicts/*.ts에 한 줄
// 추가하고 호출부에서 t('...')/tp('...', params)로 감싸면 된다 — 수동으로 이 파일을 고칠 필요 없음.
type Dict = Record<string, string>

const modules = import.meta.glob<{ default: Dict }>('./dicts/**/*.ts', { eager: true })

function mergeDicts(mods: Record<string, { default: Dict }>): Dict {
	const out: Dict = {}
	for (const [path, mod] of Object.entries(mods)) {
		for (const [k, v] of Object.entries(mod.default)) {
			// 같은 한글 키가 서로 다른 영어값으로 두 군데 정의되면, DICT는 마지막에 병합된 값으로 조용히
			// 덮어써버린다 — 어느 파일이 이겼는지 알 수 없는 채로 호출부마다 다른 번역이 섞이는 사고를
			// 막기 위해 dev 모드에서 즉시 알린다. 같은 값이면(의도된 중복) 무시.
			if (import.meta.env.DEV && k in out && out[k] !== v) {
				console.error(`[i18n] conflicting translation for key ${JSON.stringify(k)} (from ${path}): ${JSON.stringify(out[k])} vs ${JSON.stringify(v)}`)
			}
			out[k] = v
		}
	}
	return out
}

const DICT = mergeDicts(modules)

export type TpParams = Record<string, string | number>

function interpolate(base: string, params?: TpParams): string {
	return params ? base.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`)) : base
}

// non-hook 버전 — zustand 스토어 액션처럼 훅 규칙상 useT()를 못 쓰는 곳(예: useSessionsStore.ts)에서
// 직접 import해서 쓴다. useUiStore.getState()는 구독 없이 현재 값만 읽는 zustand의 표준 탈출구.
export function translate(ko: string): string {
	return useUiStore.getState().lang === 'en' ? (DICT[ko] ?? ko) : ko
}

export function translateP(template: string, params?: TpParams): string {
	const base = useUiStore.getState().lang === 'en' ? (DICT[template] ?? template) : template
	return interpolate(base, params)
}

// 컴포넌트에서 쓰는 훅 버전 — lang을 구독해서 토글 시 리렌더되게 한 뒤 위 로직에 위임.
export function useT() {
	useUiStore((s) => s.lang)
	return translate
}

export function useTp() {
	useUiStore((s) => s.lang)
	return translateP
}

export function localeFor(lang: Lang): 'ko-KR' | 'en-US' {
	return lang === 'en' ? 'en-US' : 'ko-KR'
}
