import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import SessionsPage from './pages/SessionsPage'
import { useUiStore, applyTheme } from './store/useUiStore'

// 단일 화면 앱 — SessionShell(사이드바 트리 + 탭 워크스페이스)이 전체 화면을 직접 쓴다. 레포
// 미연결 상태에서도 곧장 이 화면으로 들어간다(별도 온보딩 게이트 없음, "+ 레포 추가"는 사이드바에서).
export default function App() {
	const theme = useUiStore((s) => s.theme)
	useEffect(() => applyTheme(theme), [theme])

	return (
		<Routes>
			<Route path="sessions" element={<SessionsPage />} />
			<Route path="*" element={<Navigate to="/sessions" replace />} />
		</Routes>
	)
}
