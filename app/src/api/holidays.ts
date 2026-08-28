import { api } from './client'

export interface HolidayEntry {
	date: string // "YYYY-MM-DD"
	name: string
}
export interface HolidayCountry {
	code: string
	name: string
}

export function fetchHolidays(country: string, years: number[]) {
	return api.get<{ ok: boolean; country: string; holidays: HolidayEntry[]; error?: string }>(`/api/holidays?country=${encodeURIComponent(country)}&years=${years.join(',')}`)
}
export function fetchHolidayCountries() {
	return api.get<{ ok: boolean; countries: HolidayCountry[] }>('/api/holidays/countries')
}
