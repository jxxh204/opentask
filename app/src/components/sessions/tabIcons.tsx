import type { TabKind } from '../../store/useTabsStore'
import appIcon from '../../assets/app-icon.png'

// "탭에 아이콘 넣어줘 실제 아이콘. 태스크 매니저는 앱아이콘 넣어 유니크하게" — 탭 추가 메뉴·탭바가
// 전부 순수 텍스트였다. 나머지는 이 시스템의 기존 아이콘 관례(24x24, stroke 2, round cap/join)를
// 따르는 그려진 아이콘으로, 태스크 매니저만 실제 앱 아이콘(build/icon.png — 병렬 세션을 쌓인 터미널
// 카드로 표현한 실제 macOS 앱 아이콘)을 그대로 써서 나머지와 구분되는 유일한 컬러/래스터 아이콘이 된다.
const S = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export const TAB_ICON: Partial<Record<TabKind, React.ReactNode>> = {
	orchestrator: <img src={appIcon} alt="" width={15} height={15} style={{ borderRadius: 4, display: 'block' }} />,
	detail: (
		<svg {...S} width="14" height="14">
			<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
			<path d="M14 3v4h4M9 13h6M9 16h6M9 10h2" />
		</svg>
	),
	diagram: (
		<svg {...S} width="14" height="14">
			<circle cx="5" cy="6" r="2.4" />
			<circle cx="5" cy="18" r="2.4" />
			<circle cx="17" cy="12" r="2.4" />
			<path d="M7.3 6.9L14.8 11M7.3 17.1L14.8 13" />
		</svg>
	),
	subtask: (
		<svg {...S} width="14" height="14">
			<circle cx="12" cy="12" r="4" />
		</svg>
	),
	terminal: (
		<svg {...S} width="14" height="14">
			<rect x="3" y="4" width="18" height="16" rx="2.2" />
			<path d="M7 9.5l3 2.5-3 2.5M12.5 14.5h4.5" />
		</svg>
	),
	server: (
		<svg {...S} width="14" height="14">
			<rect x="3" y="4" width="18" height="6.5" rx="1.6" />
			<rect x="3" y="13.5" width="18" height="6.5" rx="1.6" />
			<path d="M7 7.25h.01M7 16.75h.01" />
		</svg>
	),
	browser: (
		<svg {...S} width="14" height="14">
			<rect x="3" y="4.5" width="18" height="15" rx="2" />
			<path d="M3 9h18" />
			<path d="M6.5 6.75h.01" />
		</svg>
	),
	// "클로드세션은 클로드 아이콘 넣어줘" — 실제 Claude 세션이라 이건 currentColor를 안 물려받고
	// 앤트로픽 브랜드 색(클레이 오렌지)을 그대로 쓴다 — 태스크 매니저의 실제 앱 아이콘과 같은 이유로,
	// 여기도 "이 도구가 무엇인지" 알아보는 게 목적이라 흉내낸 모노크롬보다 실제 색이 더 정확하다.
	claude: (
		<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#DA7756" strokeWidth={2.4} strokeLinecap="round">
			<line x1="15" y1="12" x2="21.5" y2="12" />
			<line x1="14.1" y1="14.1" x2="18.7" y2="18.7" />
			<line x1="12" y1="15" x2="12" y2="21.5" />
			<line x1="9.9" y1="14.1" x2="5.3" y2="18.7" />
			<line x1="9" y1="12" x2="2.5" y2="12" />
			<line x1="9.9" y1="9.9" x2="5.3" y2="5.3" />
			<line x1="12" y1="9" x2="12" y2="2.5" />
			<line x1="14.1" y1="9.9" x2="18.7" y2="5.3" />
		</svg>
	),
	// "이것도 아이콘 넣어줘" — 팀 규칙(체크리스트/클립보드)도 나머지와 같은 그려진 모노크롬 아이콘.
	teamRules: (
		<svg {...S} width="14" height="14">
			<path d="M9 3.5h6a1 1 0 0 1 1 1V5h-8v-.5a1 1 0 0 1 1-1z" />
			<path d="M7 5h10a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
			<path d="M8.3 10.3l1 1 2-2M13 10.5h3.5M8.3 15.3l1 1 2-2M13 15.5h3.5" />
		</svg>
	),
	// "아이콘 없는거 넣어줘" → "오버마인드로 이름 변경, UI도 오버마인드스럽게 강렬하게" — 원래는
	// ControlPane과 같은 모노크롬 말풍선이었으나, 이름을 "오버마인드"(태스크 하나가 아니라 앱 전체를
	// 조종하는 존재)로 바꾸며 아이콘도 뇌 형상으로 교체 — "모든 걸 조종하는 뇌"라는 컨셉을 시각적으로도
	// 드러낸다. 나머지 아이콘과 같은 모노크롬 stroke 관례(24x24, 2px, round cap/join)는 그대로 유지.
	control: (
		<svg {...S} width="14" height="14">
			<path d="M12 3.2c-1.7 0-3 1.3-3 3v.3C7.3 6.9 6 8.3 6 10.1c0 .9.3 1.7.9 2.3-.6.6-.9 1.4-.9 2.3 0 1.5 1 2.8 2.4 3.2.2 1.6 1.6 2.9 3.3 2.9h.4" />
			<path d="M12 3.2c1.7 0 3 1.3 3 3v.3c1.7.3 3 1.7 3 3.5 0 .9-.3 1.7-.9 2.3.6.6.9 1.4.9 2.3 0 1.5-1 2.8-2.4 3.2-.2 1.6-1.6 2.9-3.3 2.9h-.4" />
			<path d="M12 3.2v17.6M9 9.6h.01M15 9.6h.01M9 14.4h.01M15 14.4h.01" />
		</svg>
	),
}
