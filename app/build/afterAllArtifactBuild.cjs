'use strict'
const { execFileSync } = require('child_process')

// afterSign.cjs가 .app 번들 자체는 서명·공증하지만, DMG "컨테이너" 파일은 그 안의 .app과 별개
// 아티팩트라 electron-builder가 기본적으로 서명하지 않는다(dmg-builder의 signDmg는 build.dmg.sign
// 옵션이 true일 때만 실행 — 우린 그 옵션을 안 켰다). 서명 안 된 dmg는 다운로드 직후 마운트할 때
// Gatekeeper가 "확인되지 않음" 류 경고를 한 번 더 띄울 수 있다 — .app 자체는 이미 공증됐어도.
// 여기서 dmg만 따로 서명+공증+스테이플링해 정말 경고 없이 열리게 마무리한다.
const IDENTITY = 'Developer ID Application: JaeHwan Kim (L67FAG9382)'

module.exports = async function afterAllArtifactBuild(buildResult) {
  if (process.env.SKIP_NOTARIZE) return []
  const dmgPaths = buildResult.artifactPaths.filter((p) => p.endsWith('.dmg'))
  if (dmgPaths.length === 0) return []
  const { notarize } = require('@electron/notarize')
  for (const dmgPath of dmgPaths) {
    console.log(`🔏  afterAllArtifactBuild: DMG 서명 — ${dmgPath}`)
    execFileSync('codesign', ['--force', '--sign', IDENTITY, dmgPath], { stdio: 'inherit' })
    console.log(`🍎  afterAllArtifactBuild: DMG 공증 제출 중... — ${dmgPath}`)
    await notarize({ appPath: dmgPath, tool: 'notarytool', keychainProfile: 'opentask-notary' })
    console.log(`🍎  afterAllArtifactBuild: DMG 공증 완료 + 스테이플링됨 — ${dmgPath}`)
  }
  return []
}
