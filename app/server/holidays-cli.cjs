#!/usr/bin/env node
// holidays-cli.cjs — server-rust/src/holidays.rs가 date-holidays 패키지(200여개 국가·음력/대체공휴일
// 규칙 내장)를 그대로 재사용하기 위한 얇은 CLI 쉼. 이 규칙을 Rust로 다시 구현하지 않는다 — holidays.cjs
// 상단 주석과 같은 이유(나라마다 규칙이 다르고 자주 바뀜, 직접 하드코딩하면 매번 놓치기 쉬움).
'use strict'
const H = require('./holidays.cjs')

const [, , mode, ...args] = process.argv
try {
	if (mode === 'countries') {
		process.stdout.write(JSON.stringify(H.listCountries()))
	} else if (mode === 'holidays') {
		const country = args[0]
		const years = args.slice(1).map(Number).filter((y) => Number.isInteger(y))
		process.stdout.write(JSON.stringify(H.getHolidays(country, years)))
	} else {
		process.stderr.write('unknown mode\n')
		process.exit(1)
	}
} catch (e) {
	process.stderr.write(String((e && e.message) || e) + '\n')
	process.exit(1)
}
