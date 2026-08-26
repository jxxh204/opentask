// businessDays.ts — 태스크 기간(영업일) → 종료일 계산. "늘어나는 기준은 영업일 기준" 요청대로
// 토/일은 건너뛴다. duration_days=1이면 당일 완료(종료일 = 시작일) — N일짜리면 시작일 포함 N번째
// 영업일이 종료일이다.
export function isWeekend(d: Date) {
	const day = d.getDay()
	return day === 0 || day === 6
}

export function addBusinessDays(startMs: number, durationDays: number): number {
	if (!durationDays || durationDays <= 1) return startMs
	const d = new Date(startMs)
	let remaining = durationDays - 1
	while (remaining > 0) {
		d.setDate(d.getDate() + 1)
		if (!isWeekend(d)) remaining--
	}
	return d.getTime()
}
