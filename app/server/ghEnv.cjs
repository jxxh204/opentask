// ghEnv.cjs — gh CLI를 실행할 때 쓸 env. Setup에서 GitHub를 연동한 방식이 두 가지라 우선순위를 둔다:
//   1) OAuth(Device Flow)로 발급받았거나 사람이 직접 붙여넣은 토큰(Secrets.githubToken) — 있으면 GH_TOKEN으로 주입.
//   2) 없으면 process.env 그대로 — 로컬에 이미 `gh auth login`돼 있는 gh CLI 세션을 그대로 씀("MCP/gh CLI 위임").
// gh CLI는 GH_TOKEN이 있으면 그걸 최우선으로 쓰고, 없으면 자기 세션(~/.config/gh/hosts.yml)으로 폴백한다.
'use strict'
const Secrets = require('./store/secrets.cjs')

function ghEnv() {
	const token = Secrets.get('githubToken')
	return token ? { ...process.env, GH_TOKEN: token } : process.env
}

module.exports = { ghEnv }
