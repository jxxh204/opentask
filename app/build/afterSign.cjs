'use strict'
const { execFileSync } = require('child_process')

// 키체인에 서명 아이덴티티가 없으면(또는 CI처럼 키체인 접근이 없는 환경이면) electron-builder가
// 서명을 건너뛰고 Apple Silicon 기본 linker 서명만 남긴다 — 그 상태에서 asarUnpack(better-sqlite3/
// node-pty/server)이 앱 번들에 파일을 추가로 써 넣으면 기존 seal이 실제 파일 목록과 안 맞아
// "code has no resources but signature indicates they must be present"로 깨진다. macOS는 이 상태를
// "손상된 앱"으로 판정해 우클릭→열기 우회조차 안 통하고 즉시 실행을 막는다(실제 v0.1.0 릴리스에서
// 재현·확인됨). 그래서 서명이 실제로 깨졌을 때만 ad-hoc으로 다시 봉인한다 — electron-builder가 이미
// Developer ID 등 제대로 된 인증서로 서명했다면 그 서명을 절대 덮어쓰지 않는다(덮어쓰면 오히려
// 진짜 서명이 ad-hoc으로 강등된다 — 실제로 한 번 이 실수를 함).
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' })
    console.log(`🔏  afterSign: 기존 서명이 유효함 — 그대로 둠 (${appPath})`)
  } catch (e) {
    console.log(`🔏  afterSign: 기존 서명이 깨져 있어(${(e.stderr || '').toString().trim() || e.message}) ad-hoc으로 재서명 — ${appPath}`)
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  }
}
