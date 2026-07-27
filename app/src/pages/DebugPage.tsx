import { useEffect } from 'react'
import { useDebugStore } from '../store/useDebugStore'
import { useSetupStore, isDebugConfigured } from '../store/useSetupStore'
import DebugSetupGate from '../components/common/DebugSetupGate'
import TargetPickerBar from '../components/debug/TargetPickerBar'
import HierarchyBar from '../components/debug/HierarchyBar'
import PreviewStage from '../components/debug/PreviewStage'
import CollapsedInspectorHandles from '../components/debug/CollapsedInspectorHandles'
import InspectorDrawer from '../components/debug/InspectorDrawer'
import ThreadResultModal from '../components/debug/ThreadResultModal'

// Phase 4a built the static UI shell against fixture data; Phase 4b (now)
// wires a real Playwright-backed session via useDebugStore's startSession().
export default function DebugPage() {
	const configured = useSetupStore(isDebugConfigured)
	const hydrateSetup = useSetupStore((s) => s.hydrate)
	const drawerOpen = useDebugStore((s) => s.drawerOpen)
	const stopSession = useDebugStore((s) => s.stopSession)

	useEffect(() => {
		hydrateSetup()
	}, [hydrateSetup])

	// tear down the real browser session on navigating away — leaving it running
	// in the background would both waste resources and leak a Chromium process.
	useEffect(() => () => {
		stopSession()
	}, [stopSession])

	if (!configured) return <DebugSetupGate />

	return (
		<div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0d11' }}>
			<TargetPickerBar />
			<HierarchyBar />
			<div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
				<PreviewStage />
				{!drawerOpen && <CollapsedInspectorHandles />}
				<InspectorDrawer />
			</div>
			<ThreadResultModal />
		</div>
	)
}
