import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Shell from './components/shell/Shell'
import SessionsPage from './pages/SessionsPage'
import DebugPage from './pages/DebugPage'
import GithubPage from './pages/GithubPage'
import MonitorPage from './pages/MonitorPage'
import ArchitecturePage from './pages/ArchitecturePage'
import SetupPage from './pages/SetupPage'
import { useUiStore, applyTheme } from './store/useUiStore'

// Route table per PRD §4 — the prototype shell's internal nav `tag` fields
// (e.g. '/watch', '/graph') are just placeholder strings from the mockup and
// are intentionally NOT used here; this table is the authoritative one.
//
// Sessions는 더 이상 Shell(ActivityBar+ContextPanel)로 감싸지 않는다 — 터미널 셸 프로토타입을
// 그대로 이식한 SessionShell(사이드바 트리 + 탭 워크스페이스)이 전체 화면을 직접 쓴다. 나머지
// 페이지(Debug/GitHub/Monitor/Architecture/Setup)는 이번 포팅 범위 밖이라 기존 Shell 그대로 유지.
export default function App() {
	const theme = useUiStore((s) => s.theme)
	useEffect(() => applyTheme(theme), [theme])

	return (
		<Routes>
			<Route path="sessions" element={<SessionsPage />} />
			<Route element={<Shell />}>
				<Route index element={<Navigate to="/sessions" replace />} />
				<Route path="debug" element={<DebugPage />} />
				<Route path="github" element={<GithubPage />} />
				<Route path="monitor" element={<MonitorPage />} />
				<Route path="architecture" element={<ArchitecturePage />} />
				<Route path="setup" element={<SetupPage />} />
				<Route path="*" element={<Navigate to="/sessions" replace />} />
			</Route>
		</Routes>
	)
}
