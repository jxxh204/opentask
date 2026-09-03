'use strict'
const { execFileSync } = require('child_process')
const path = require('path')

// 키체인에 서명 아이덴티티가 없으면(또는 CI처럼 키체인 접근이 없는 환경이면) electron-builder가
// 서명을 건너뛰고 Apple Silicon 기본 linker 서명만 남긴다 — 그 상태에서 asarUnpack(better-sqlite3/
// node-pty/server)이 앱 번들에 파일을 추가로 써 넣으면 기존 seal이 실제 파일 목록과 안 맞아
// "code has no resources but signature indicates they must be present"로 깨진다. macOS는 이 상태를
// "손상된 앱"으로 판정해 우클릭→열기 우회조차 안 통하고 즉시 실행을 막는다(실제 v0.1.0 릴리스에서
// 재현·확인됨). 그래서 서명이 실제로 깨졌을 때만 다시 서명한다 — electron-builder가 이미 Developer ID로
// 서명했다면 그 서명을 절대 덮어쓰지 않는다. 재서명이 필요한 드문 경우엔(공증 대상이라) ad-hoc이 아니라
// 똑같은 Developer ID + hardened runtime + entitlements로 다시 서명해야 한다 — ad-hoc이면 공증 제출
// 자체가 거부된다.
const IDENTITY = 'Developer ID Application: JaeHwan Kim (L67FAG9382)'
const ENTITLEMENTS = path.join(__dirname, 'entitlements.mac.plist')

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' })
    console.log(`🔏  afterSign: 기존 서명이 유효함 — 그대로 둠 (${appPath})`)
  } catch (e) {
    console.log(`🔏  afterSign: 기존 서명이 깨져 있어(${(e.stderr || '').toString().trim() || e.message}) Developer ID로 재서명 — ${appPath}`)
    execFileSync('codesign', ['--force', '--deep', '--options', 'runtime', '--entitlements', ENTITLEMENTS, '--sign', IDENTITY, appPath], { stdio: 'inherit' })
  }

  // "다운로드 받은 사람들은 업데이트를 어떻게 알아?" 대화에서 이어짐 — 서명만으론 macOS Gatekeeper의
  // "확인되지 않은 개발자" 경고를 못 없앤다. Apple 공증(notarization)까지 통과해야 우클릭 없이 그냥
  // 열린다. SKIP_NOTARIZE=1이면 건너뛴다(공증 자격증명 없는 환경에서 로컬 빌드만 해볼 때용).
  if (process.env.SKIP_NOTARIZE) {
    console.log('🍎  afterSign: SKIP_NOTARIZE 설정됨 — 공증 건너뜀')
    return
  }
  const { notarize } = require('@electron/notarize')
  console.log(`🍎  afterSign: 공증 제출 중... (수 분 소요될 수 있음) — ${appPath}`)
  await notarize({
    appPath,
    tool: 'notarytool',
    keychainProfile: 'opentask-notary',
  })
  console.log('🍎  afterSign: 공증 완료 + 티켓 스테이플링됨')
}
