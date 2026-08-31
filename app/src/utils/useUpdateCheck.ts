import { useEffect, useState } from 'react'

// "다운로드 받은 사람들은 업데이트를 어떻게 알아?" — electron-updater 자동 설치는 Apple 공증 전까지
// 조용히 실패한다(§ electron/main.cjs checkForUpdates 주석). 그 파이프라인이 붙기 전까지는 GitHub
// Releases의 최신 태그를 직접 확인해 상태바에 알려주는 게 유일하게 실제로 동작하는 경로다.
const REPO = 'jxxh204/opentask'
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6시간 — 배포 빈도 대비 과한 폴링을 피한다
const CACHE_KEY = 'openrm.updateCheck'

type UpdateInfo = { latestVersion: string; url: string } | null

function parseVersion(v: string): number[] {
	return v
		.replace(/^v/, '')
		.split('.')
		.map((n) => parseInt(n, 10) || 0)
}

function isNewer(latest: string, current: string): boolean {
	const a = parseVersion(latest)
	const b = parseVersion(current)
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? 0
		const y = b[i] ?? 0
		if (x !== y) return x > y
	}
	return false
}

export function useUpdateCheck(): UpdateInfo {
	const [info, setInfo] = useState<UpdateInfo>(null)

	useEffect(() => {
		// 개발 모드(window.openrm 없음)에선 항상 package.json 버전 그대로라 확인할 이유가 없다.
		if (!window.openrm?.isElectron) return
		let cancelled = false
		;(async () => {
			try {
				const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
				const currentVersion = await window.openrm!.getAppVersion()
				if (cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) {
					if (cached.latestVersion && isNewer(cached.latestVersion, currentVersion) && !cancelled) {
						setInfo({ latestVersion: cached.latestVersion, url: cached.url })
					}
					return
				}
				const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
				if (!res.ok) return
				const data = await res.json()
				const latestVersion = String(data.tag_name || '').replace(/^v/, '')
				const url = data.html_url || `https://github.com/${REPO}/releases/latest`
				localStorage.setItem(CACHE_KEY, JSON.stringify({ checkedAt: Date.now(), latestVersion, url }))
				if (!cancelled && latestVersion && isNewer(latestVersion, currentVersion)) {
					setInfo({ latestVersion, url })
				}
			} catch (_) {
				// 네트워크 오류는 조용히 무시 — 업데이트 알림은 부가 기능이라 실패해도 앱 사용엔 지장 없어야 한다.
			}
		})()
		return () => {
			cancelled = true
		}
	}, [])

	return info
}
