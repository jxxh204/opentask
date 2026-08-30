// 모바일 내비게이션 토글
const toggle = document.querySelector('.nav-toggle')
const links = document.querySelector('.nav-links')
if (toggle && links) {
	toggle.addEventListener('click', () => {
		links.classList.toggle('open')
	})
	links.querySelectorAll('a').forEach((a) =>
		a.addEventListener('click', () => links.classList.remove('open'))
	)
}

// 코드블록 복사 버튼 — 문서 lang(ko/en)에 맞춰 라벨 선택
const isEn = document.documentElement.lang === 'en'
const COPY_LABEL = isEn ? 'Copy' : '복사'
const COPIED_LABEL = isEn ? 'Copied' : '복사됨'
document.querySelectorAll('.codeblock').forEach((block) => {
	const btn = document.createElement('button')
	btn.className = 'copy'
	btn.type = 'button'
	btn.textContent = COPY_LABEL
	btn.addEventListener('click', async () => {
		const text = block.querySelector('code')?.textContent ?? block.textContent ?? ''
		try {
			await navigator.clipboard.writeText(text.trim())
			btn.textContent = COPIED_LABEL
			setTimeout(() => (btn.textContent = COPY_LABEL), 1400)
		} catch {
			// 클립보드 권한이 없으면 조용히 무시
		}
	})
	block.appendChild(btn)
})

// 홈페이지 라이브 데모 탭 — 탭 클릭 시 해당 영상만 보이게 전환하고, 매번 처음부터 재생
const demoTabs = document.querySelectorAll('.demo-tab')
if (demoTabs.length) {
	const demoVideos = document.querySelectorAll('.demo-video')
	demoTabs.forEach((tab) => {
		tab.addEventListener('click', () => {
			const targetId = tab.dataset.target
			demoTabs.forEach((t) => t.classList.toggle('active', t === tab))
			demoVideos.forEach((v) => {
				if (v.id === targetId) {
					v.classList.add('active')
					v.currentTime = 0
					v.play()
				} else {
					v.classList.remove('active')
					v.pause()
				}
			})
		})
	})
}

// docs 스크린샷 클릭 확대(라이트박스) — 이미지만 대상, 영상은 제외
const docsShots = document.querySelectorAll('img.docs-shot')
if (docsShots.length) {
	const overlay = document.createElement('div')
	overlay.className = 'lightbox-overlay'
	overlay.hidden = true
	const overlayImg = document.createElement('img')
	overlay.appendChild(overlayImg)
	document.body.appendChild(overlay)

	const close = () => {
		overlay.hidden = true
		overlayImg.src = ''
	}
	overlay.addEventListener('click', close)
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && !overlay.hidden) close()
	})

	docsShots.forEach((img) => {
		img.addEventListener('click', () => {
			overlayImg.src = img.src
			overlayImg.alt = img.alt
			overlay.hidden = false
		})
	})
}

// docs 사이드바 스크롤 스파이
const docsNav = document.querySelector('.docs-nav')
if (docsNav) {
	const navLinks = Array.from(docsNav.querySelectorAll('a[href^="#"]'))
	const sections = navLinks
		.map((a) => document.querySelector(a.getAttribute('href')))
		.filter(Boolean)

	const setActive = (id) => {
		navLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${id}`))
	}

	if ('IntersectionObserver' in window && sections.length) {
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries.filter((e) => e.isIntersecting)
				if (visible.length) setActive(visible[0].target.id)
			},
			{ rootMargin: '-20% 0px -70% 0px' }
		)
		sections.forEach((s) => observer.observe(s))
	}
}
