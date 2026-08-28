// actuator.cjs — 지시(Control)의 쓰기/실행 담당. 감시(읽기)와 분리된 위험 영역.
// 에이전트 세션(term.cjs가 소유한 node-pty 프로세스)에 프롬프트를 입력. 화이트리스트 + 드라이런 필수.
'use strict'
const C = require('./collector.cjs')
const Term = require('./term.cjs')

// 허용 세션 = state.json에 등록된 에이전트(에픽워크플로우) + term.cjs가 실제로 띄운 orm-* 세션(디버깅 dbg-에이전트 등).
// 두 소스 다 이 앱이 만든 세션만 노출하므로 임의 세션/명령 차단이라는 목적은 그대로 유지된다.
async function knownSessions() {
  const m = C.readModel()
  const known = new Map((m.agents || []).map((a) => [a.tmuxSession, a]))
  const live = await Term.list().catch(() => [])
  for (const s of live) if (!known.has(s.name)) known.set(s.name, { agent: s.label })
  return known
}

// 프롬프트 디스패치: 세션에 텍스트 입력 후 Enter.
// dryRun=true면 실제 전송 없이 미리보기만 반환.
async function dispatch({ session, message, dryRun = true }) {
  if (!session || !message) return { ok: false, error: 'session·message 필수' }
  const known = await knownSessions()
  if (!known.has(session)) return { ok: false, error: `허용되지 않은 세션: ${session} (state.json 미등록)` }

  const alive = await Term.exists(session)

  const preview = {
    session,
    agent: known.get(session)?.agent,
    alive,
    chars: message.length,
    commands: ['(세션에 문자 그대로 입력 후 Enter)'],
    messagePreview: message.slice(0, 400),
  }
  // 미리보기는 미기동이어도 허용 (무엇이 실행될지 보여주기)
  if (dryRun) return { ok: true, dryRun: true, alive, preview }
  // 실제 전송은 살아있어야 함
  if (!alive) return { ok: false, error: `세션 미기동: ${session}`, alive: false, preview }

  const r = await Term.send({ name: session, message, enter: true })
  return r.ok ? { ok: true, sent: true, preview } : { ok: false, error: r.error, preview }
}

// 프롬프트 템플릿 (프론트 빠른 버튼용)
const TEMPLATES = [
  { id: 'resume', label: '이어서', text: '이어서 진행해줘. 막힌 게 있으면 먼저 보고해줘.' },
  { id: 'status', label: '상태보고', text: '지금 상태 한 줄로 보고해줘 (현재 작업/막힌점/다음).' },
  { id: 'p1', label: '🔥P1', text: '[🔥P1] 다음 핫픽스를 최우선으로 처리해줘: ' },
  { id: 'review', label: '리뷰루프', text: 'figma-review-loop로 완성도 100%까지 셀프리뷰 돌려줘.' },
  { id: 'pr', label: 'PR', text: '현재 변경 커밋하고 draft PR 올려줘 (셀프리뷰 후).' },
]

module.exports = { dispatch, TEMPLATES }
