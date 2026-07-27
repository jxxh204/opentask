import { Routes, Route, Navigate } from 'react-router-dom'
import Shell from './components/shell/Shell'
import SessionsPage from './pages/SessionsPage'
import DebugPage from './pages/DebugPage'
import GithubPage from './pages/GithubPage'
import MonitorPage from './pages/MonitorPage'
import ArchitecturePage from './pages/ArchitecturePage'
import SetupPage from './pages/SetupPage'

// Route table per PRD §4 — the prototype shell's internal nav `tag` fields
// (e.g. '/watch', '/graph') are just placeholder strings from the mockup and
// are intentionally NOT used here; this table is the authoritative one.
export default function App() {
	return (
		<Routes>
			<Route element={<Shell />}>
				<Route index element={<Navigate to="/sessions" replace />} />
				<Route path="sessions" element={<SessionsPage />} />
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
