import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { fetchHolidays, fetchHolidayCountries, type HolidayCountry } from '../api/holidays'

// "캘린더에 대한민국 공휴일도 적용해줘. 나라에 따라 나오게 해주면 더 좋고" — 나라 코드는 설정으로
// 남기고(기본 KR), 실제 공휴일 데이터는 여기 캐시한다. dateKey(YYYY-MM-DD)는 CalendarPane.tsx의
// dateKey()·서버 holidays.cjs의 fmt()와 똑같은 포맷이라 세 곳이 그대로 맞춰 쓸 수 있다.
function pad(n: number) {
	return String(n).padStart(2, '0')
}
export function dateKey(d: Date) {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// "나라는 설정에서 설정되도록해주고 기본은 컴퓨터 시간?으로해줘" — 하드코딩된 KR 대신, 이 컴퓨터의
// OS 언어 설정(navigator.language, 예: "ko-KR"의 지역 서브태그)에서 나라를 추정한다. 명시적으로 값을
// 안 골랐을 때만 쓰는 최초 기본값이고(§ persist), 한 번이라도 설정에서 바꾸면 그 뒤로는 그 값이 남는다.
function detectDefaultCountry(): string {
	try {
		const langs = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []
		for (const l of langs) {
			const region = l?.split('-')[1]
			if (region && region.length === 2) return region.toUpperCase()
		}
	} catch {
		/* navigator 접근 실패 — 아래 폴백 */
	}
	return 'KR'
}

interface HolidayState {
	country: string
	byDate: Record<string, string> // dateKey → 공휴일 이름(그 나라 로케일 원문)
	loadedYears: Record<string, boolean> // `${country}:${year}` → fetched
	countries: HolidayCountry[]
	countriesLoaded: boolean

	setCountry(country: string): void
	ensureYears(years: number[]): void
	loadCountries(): void
	isHoliday(d: Date): boolean
	holidayName(d: Date): string | null
}

export const useHolidayStore = create<HolidayState>()(
	persist(
		(set, get) => ({
			country: detectDefaultCountry(),
			byDate: {},
			loadedYears: {},
			countries: [],
			countriesLoaded: false,

			setCountry: (country) => {
				// 나라를 바꾸면 이전 나라의 캐시는 더 이상 안 맞으니 통째로 비우고 다시 받는다.
				set({ country, byDate: {}, loadedYears: {} })
			},

			ensureYears: (years) => {
				const country = get().country
				const missing = years.filter((y) => !get().loadedYears[`${country}:${y}`])
				if (!missing.length) return
				// 먼저 "요청함"으로 찍어 같은 렌더 사이클에서 중복 fetch가 안 나가게 한다.
				set((s) => ({ loadedYears: { ...s.loadedYears, ...Object.fromEntries(missing.map((y) => [`${country}:${y}`, true])) } }))
				fetchHolidays(country, missing)
					.then((r) => {
						if (!r.ok || get().country !== country) return // 응답 오는 사이 나라가 또 바뀌었으면 버림
						set((s) => {
							const byDate = { ...s.byDate }
							for (const h of r.holidays) byDate[h.date] = h.name
							return { byDate }
						})
					})
					.catch(() => {
						// 실패하면 다음에 다시 시도할 수 있게 "요청함" 표시를 되돌린다.
						set((s) => {
							const loadedYears = { ...s.loadedYears }
							for (const y of missing) delete loadedYears[`${country}:${y}`]
							return { loadedYears }
						})
					})
			},

			loadCountries: () => {
				if (get().countriesLoaded) return
				set({ countriesLoaded: true })
				fetchHolidayCountries()
					.then((r) => {
						if (r.ok) set({ countries: r.countries })
					})
					.catch(() => set({ countriesLoaded: false }))
			},

			isHoliday: (d) => !!get().byDate[dateKey(d)],
			holidayName: (d) => get().byDate[dateKey(d)] ?? null,
		}),
		{ name: 'opentask.holidays', partialize: (s) => ({ country: s.country }) },
	),
)
