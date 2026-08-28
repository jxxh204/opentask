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
