import { useEffect } from 'react'
import { useSetupStore } from '../store/useSetupStore'
import { useSessionsStore } from '../store/useSessionsStore'
import { useQuickstartStore } from '../store/useQuickstartStore'
import SessionShell from '../components/sessions/SessionShell'
import QuickstartModal from '../components/sessions/QuickstartModal'

export default function SessionsPage() {
	const hydrateSetup = useSetupStore((s) => s.hydrate)
	const loadBoard = useSessionsStore((s) => s.loadBoard)
	const loadRepos = useSessionsStore((s) => s.loadRepos)
	const loadBlockedPeriods = useSessionsStore((s) => s.loadBlockedPeriods)
	const quickstartOpen = useQuickstartStore((s) => s.open)
	const openQuickstartIfUnseen = useQuickstartStore((s) => s.openIfUnseen)
	const hideQuickstart = useQuickstartStore((s) => s.hide)

	useEffect(() => {
		hydrateSetup()
	}, [hydrateSetup])

	// 레포 미연결 상태에서도 곧장 메인 화면(태스크 매니저 등)으로 들어간다 — 폴더 경로를 먼저
	// 강제로 받는 게이트가 있었으나(SessionsSetupGate), "설정 없이 켜면 데모 데이터로 바로 탐색
	// 가능"이 원래 의도였다(§ README). 레포 연결은 사이드바 "+ 레포 추가"로 언제든 할 수 있다.
	useEffect(() => {
		loadBoard()
		loadRepos()
		loadBlockedPeriods()
		openQuickstartIfUnseen()
	}, [loadBoard, loadRepos, loadBlockedPeriods, openQuickstartIfUnseen])

	return (
		<>
			<SessionShell />
			<QuickstartModal open={quickstartOpen} onClose={hideQuickstart} />
		</>
	)
}
