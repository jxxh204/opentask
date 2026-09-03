// 7개 파일(TaskRow/FolderCard/SessionShell/OrchestratorPane/ControlPane/StatusBoard/SubagentStrip)에
// 복붙돼 있던 timeAgo를 하나로 합친 것 — 표시 형식은 기존 각 자리 그대로 보존한다. StatusBoard만
// "5분 전" 같은 긴 어미를 쓰고 나머지는 "5m" 짧은 접미사를 쓰며, SubagentStrip만 ISO 문자열을 받는다
// (서브에이전트 API가 ms가 아니라 ISO로 내려준다).
import { translate } from './i18n'

function minutesSince(ts: number) {
	return Math.floor((Date.now() - ts) / 60000)
}

export function timeAgo(ts: number): string {
	const min = minutesSince(ts)
	if (min < 1) return translate('방금')
	if (min < 60) return `${min}m`
	const hr = Math.floor(min / 60)
	if (hr < 24) return `${hr}h`
	return `${Math.floor(hr / 24)}d`
}

export function timeAgoLong(ts: number): string {
	const min = minutesSince(ts)
	if (min < 1) return translate('방금')
	if (min < 60) return `${min}분 전`
	const hr = Math.floor(min / 60)
	if (hr < 24) return `${hr}시간 전`
	return `${Math.floor(hr / 24)}일 전`
}

export function timeAgoFromIso(iso: string | null): string {
	if (!iso) return ''
	return timeAgo(new Date(iso).getTime())
}
