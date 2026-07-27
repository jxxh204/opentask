import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// OpenRM 프론트(CSR)는 5180에서 뜨고, 백엔드(collector+SSE) 8770으로 프록시.
// OPENRM_PORT로 백엔드 포트를 바꿀 수 있음 (여러 REPO_PATH 인스턴스를 동시에 띄울 때 사용).
const backendPort = process.env.OPENRM_PORT || 8770
const backendUrl = `http://localhost:${backendPort}`

export default defineConfig({
	plugins: [react()],
	server: {
		port: Number(process.env.OPENRM_VITE_PORT) || 5180,
		host: true, // 0.0.0.0 바인딩 — 같은 Wi-Fi의 폰에서 http://<Mac LAN IP>:5180 으로 접속 가능
		proxy: {
			// 슬래시 포함 — 백엔드는 전부 /api/* 라서 프론트 라우트(/apimap 등 /api 접두)를 가로채지 않게 한다.
			'/api/': backendUrl,
			'/events': { target: backendUrl, changeOrigin: true },
			// 실터미널 WebSocket (xterm ↔ node-pty/tmux)
			'/term': { target: backendUrl.replace('http', 'ws'), ws: true },
		},
	},
})
