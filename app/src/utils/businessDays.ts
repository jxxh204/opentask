// businessDays.ts — 태스크 기간(영업일) → 종료일 계산. "늘어나는 기준은 영업일 기준" 요청대로
// 토/일은 건너뛴다. duration_days=1이면 당일 완료(종료일 = 시작일) — N일짜리면 시작일 포함 N번째
// 영업일이 종료일이다.
import { useHolidayStore } from '../store/useHolidayStore'

export function isWeekend(d: Date) {
	const day = d.getDay()
	return day === 0 || day === 6
}

// "캘린더에 대한민국 공휴일도 적용해줘" — 영업일 계산도 공휴일을 건너뛴다(주말과 같은 취급). 공휴일
// 데이터는 useHolidayStore가 백그라운드로 미리 받아둔 캐시를 그냥 동기로 읽는다 — 아직 그 연도를
// 못 받았으면(첫 로드 순간 등) 정직하게 "공휴일 아님"으로 취급하고, 데이터가 도착하면 그걸 쓰는
// 화면(CalendarPane)이 다시 렌더될 때 자연히 맞는 값으로 바뀐다.
export function isNonBusinessDay(d: Date) {
	return isWeekend(d) || useHolidayStore.getState().isHoliday(d)
}

export function addBusinessDays(startMs: number, durationDays: number): number {
	if (!durationDays || durationDays <= 1) return startMs
	const d = new Date(startMs)
	let remaining = durationDays - 1
	while (remaining > 0) {
		d.setDate(d.getDate() + 1)
		if (!isNonBusinessDay(d)) remaining--
	}
	return d.getTime()
}

// "적용해서 5일로 확정됐으면 주/월 캘린더에서도 그만큼 길어져야해" — 캘린더에 며칠짜리 칩으로
// 이어 그리려면 시작일~종료일 사이의 "달력상의" 모든 날짜가 필요하다(종료일 자체는 영업일 기준으로
// 건너뛰며 계산하지만, 그 사이에 낀 주말은 화면에서는 그대로 지나가는 날로 보여준다 — 예: 화요일
// 시작 5영업일이면 그 다음 주 월요일까지, 사이의 토·일도 막대가 지나가는 걸로 표시).
export function businessDayRange(startMs: number, durationDays: number): Date[] {
	const endMs = addBusinessDays(startMs, durationDays || 1)
	const days: Date[] = []
	for (const d = new Date(startMs); d.getTime() <= endMs; d.setDate(d.getDate() + 1)) {
		days.push(new Date(d))
	}
	return days
}
