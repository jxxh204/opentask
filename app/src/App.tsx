import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import SessionsPage from './pages/SessionsPage'
import { useUiStore, applyTheme } from './store/useUiStore'

// 단일 화면 앱 — SessionShell(사이드바 트리 + 탭 워크스페이스)이 전체 화면을 직접 쓴다. 설정 전
// 첫 진입은 SessionsPage 안의 SessionsSetupGate가 인라인으로 처리하므로 별도 라우트가 필요 없다.
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
