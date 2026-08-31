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
	// "눈에 띄고 혼자 섬뜩? 강렬한 리더의 인상" + "대화할때 아이콘은 상자속 뇌" — 뇌 윤곽만 있던
	// 아이콘을 "표본함(유리병) 속에 든 뇌"로 업그레이드(§ SessionShell.tsx CONTROL_ICON과 동일 형상 —
	// 사이드바·탭·채팅 아바타 전부 같은 실루엣). 이 14px 탭 자리는 나머지 탭 아이콘과 같은 순수
	// 모노크롬(currentColor)만 쓴다 — violet 채움 명멸은 더 큰 사이드바 아이콘(§ SessionShell)과
	// 채팅 아바타(§ ControlPane.tsx CONTROL_AVATAR_ICON) 전용이다. 이 크기에서 색+애니메이션까지
	// 겹치면 오히려 뭉개져 안 읽힌다.
	control: (
		<svg {...S} width="14" height="14">
			<rect x="10.6" y="3.4" width="2.8" height="2.2" rx="0.6" />
			<rect x="7" y="6.2" width="10" height="14" rx="4.2" />
			<path d="M12 8.6v10.4" />
			<path d="M9.6 11h.01M14.4 13.6h.01" />
		</svg>
	),
}
