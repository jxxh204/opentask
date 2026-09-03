// TaskDetailContent.tsx의 링크 추출 정규식이 SubtaskDetailPanel.tsx에 그대로 다시 복붙됐던 것을
// 하나로 합친 것 — 설명 텍스트에서 URL을 뽑아 링크 칩/개발 브리핑(LinkBriefSection)에 넘긴다.
export const URL_RE = /https?:\/\/[^\s)\]}"'<>]+/g

export function extractLinks(text: string): string[] {
	return Array.from(new Set(text.match(URL_RE) ?? []))
}
