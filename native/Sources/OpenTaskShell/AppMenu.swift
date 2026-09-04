import AppKit

// main.cjs buildAppMenu()와 동일한 최소 메뉴 — AppKit은 표준 role(orderFrontStandardAboutPanel,
// cut/copy/paste/undo/redo 등)에 기본 accelerator를 자동으로 물려주므로 Electron보다 코드가 더 짧다.
enum AppMenu {
	static func build() -> NSMenu {
		let main = NSMenu()

		let appMenuItem = NSMenuItem()
		let appMenu = NSMenu()
		appMenu.addItem(withTitle: "About OpenTask", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
		appMenu.addItem(.separator())
		let hideItem = appMenu.addItem(withTitle: "Hide OpenTask", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
		hideItem.target = NSApp
		let hideOthers = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
		hideOthers.keyEquivalentModifierMask = [.command, .option]
		appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
		appMenu.addItem(.separator())
		appMenu.addItem(withTitle: "Quit OpenTask", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
		appMenuItem.submenu = appMenu
		main.addItem(appMenuItem)

		let editMenuItem = NSMenuItem()
		let editMenu = NSMenu(title: "Edit")
		editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
		editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
		editMenu.addItem(.separator())
		editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
		editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
		editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
		editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
		editMenuItem.submenu = editMenu
		main.addItem(editMenuItem)

		// Window 메뉴에 "Close"를 안 넣는다 — main.cjs와 같은 이유(Cmd+W는 렌더러의 "탭 닫기"가 가져감).
		let windowMenuItem = NSMenuItem()
		let windowMenu = NSMenu(title: "Window")
		windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
		windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
		windowMenuItem.submenu = windowMenu
		main.addItem(windowMenuItem)

		return main
	}
}
