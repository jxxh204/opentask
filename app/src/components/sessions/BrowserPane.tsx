import { useEffect } from 'react'
import { useDebugStore } from '../../store/useDebugStore'
import BrowserToolbar from './BrowserToolbar'
import PreviewStage from '../debug/PreviewStage'
import CollapsedInspectorHandles from '../debug/CollapsedInspectorHandles'
import InspectorDrawer from '../debug/InspectorDrawer'
import ThreadResultModal from '../debug/ThreadResultModal'

// /debug 페이지와 같은 실제 Playwright 백엔드(useDebugStore/PreviewStage/InspectorDrawer)를 재사용
// 하되, 헤더는 프로토타입의 실제 브라우저 크롬 툴바(BrowserToolbar — 뒤/앞/새로고침/주소창/env)로
// 교체했다. 기존 TargetPickerBar/HierarchyBar는 더 이상 여기서 안 쓴다(HierarchyBar의 ENV/SERVER/
// SESSION 브레드크럼은 애초에 고정 fixture였다 — 실데이터 손실 없음). taskId를 실제로 넘겨서
// InspectorDrawer의 "반영" 지시가 이 태스크의 살아있는 세션에 꽂히게 한다(기존 /debug 페이지는
// 이 값을 늘 null로 넘겨왔다 — 태스크 선택 UI가 아직 없었기 때문).
//
// useDebugStore는 여전히 전역 싱글턴이다 — 탭을 벗어나면(언마운트) 세션을 정리하므로, 태스크 A의
// 브라우저 탭에서 B로 옮기면 A의 세션은 끊긴다. 헤드리스 Chromium을 무제한으로 띄워두지 않는다는
// 점에서 이건 버그가 아니라 의도된 동작 — 완전한 탭별 멀티 인스턴스는 더 큰 스토어 리팩터가 필요하다.
export default function BrowserPane({ taskId, cwd }: { taskId: string; cwd: string | null }) {
	const stopSession = useDebugStore((s) => s.stopSession)

	useEffect(() => () => {
		stopSession()
	}, [stopSession])

	const drawerOpen = useDebugStore((s) => s.drawerOpen)

	return (
		<div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
			<BrowserToolbar taskId={taskId} cwd={cwd} />
			<div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
				<PreviewStage />
				{!drawerOpen && <CollapsedInspectorHandles />}
				<InspectorDrawer />
			</div>
			<ThreadResultModal />
		</div>
	)
}
