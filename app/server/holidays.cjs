// holidays.cjs — 공휴일(§CalendarPane "대한민국 공휴일 적용해줘" + "나라에 따라 나오게"). date-holidays
// 패키지(오프라인, 200여개 국가·음력/대체공휴일 규칙 내장)를 그대로 감싼다 — 이 앱이 직접 음력 변환·
// 대체공휴일 규칙을 유지보수하지 않는다(나라마다 규칙이 다르고 자주 바뀐다 — 예: 한국 제헌절이
// 2026년부터 18년 만에 법정공휴일로 재지정된 것처럼, 직접 하드코딩하면 매번 놓치기 쉽다).
'use strict'
const Holidays = require('date-holidays')

const hdCache = new Map() // countryCode → Holidays instance (국가 바뀔 때마다 새로 안 만들게 캐시)
function hdFor(country) {
	let hd = hdCache.get(country)
	if (!hd) {
		hd = new Holidays(country)
		hdCache.set(country, hd)
	}
	return hd
}

function fmt(d) {
	const p = (n) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 캘린더가 그대로 그릴 수 있는 형태로: 여러 날짜짜리(설날/추석 연휴 등)는 date-holidays의 start/end를
// 펼쳐서 각 날짜별 항목으로 만든다 — 프론트가 dateKey로 바로 조회할 수 있게.
function getHolidays(country, years) {
	const hd = hdFor(country)
	const out = []
	for (const year of years) {
		const list = hd.getHolidays(year) || []
		for (const h of list) {
			if (h.type !== 'public') continue // bank/school/observance 등은 실제 휴일이 아니라 제외
			const start = new Date(h.start)
			const end = new Date(h.end) // date-holidays는 end를 다음날 00:00(배타적)으로 준다
			for (const d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
				out.push({ date: fmt(d), name: h.name })
			}
		}
	}
	return out
}

// 설정 화면의 "나라" 드롭다운용 — { code, name }[]. name은 date-holidays가 아는 나라 이름(영문) 그대로.
function listCountries() {
	const hd = hdFor('KR')
	const countries = hd.getCountries('en') || {}
	return Object.entries(countries)
		.map(([code, name]) => ({ code, name }))
		.sort((a, b) => a.name.localeCompare(b.name))
}

module.exports = { getHolidays, listCountries }
