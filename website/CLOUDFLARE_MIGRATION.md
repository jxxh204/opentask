# Cloudflare 이전 설계 — Stage 1: opentask-website

3단계 이전 계획(website → portfolio → couple-budget) 중 첫 단계. 가장 리스크가 낮은 프로젝트부터
실제로 되는지 검증하는 게 목적이라, 이 문서도 이 프로젝트 하나에만 집중한다.

## 목표

- Vercel → Cloudflare Workers(정적 자산)로 호스팅 이전
- 배포/설정을 CLI(wrangler) + 코드로 끝내서, 사람이 대시보드를 클릭할 필요가 최소화되고
  AI 에이전트가 직접 배포·설정 변경을 할 수 있게 만든다
- DNS는 되돌릴 수 있게, Vercel 프로젝트는 검증 끝나기 전까지 남겨둔다

## 현재 상태 (확인 완료)

- `website/`는 순수 Vite 정적 빌드. `vercel.json` 없음, SSR/API route 없음, Vercel 전용
  SDK(Analytics, Blob 등) 참조 없음 — grep으로 확인.
- 빌드 진입점 8개: `index/download/docs/changelog` × `ko/en` (`vite.config.ts` 참고)
- 배포 방식: Vercel Git 연동 자동 배포 (push할 때마다 Vercel이 빌드)
- 도메인: `opentask.jaehwankim.dev`

## 실현 가능성 체크

| 항목 | 결과 | 근거 |
|---|---|---|
| Vercel 전용 기능 의존 | 없음 | `vercel.json` 부재, 코드 grep 결과 없음 |
| 어댑터 필요 여부 | 불필요 | SSR/ISR 없는 순수 정적 사이트 |
| DNS 네임서버 | 이미 Cloudflare | `dig NS jaehwankim.dev` → `gina.ns.cloudflare.com`, `elias.ns.cloudflare.com` |
| 도메인 응답 IP | Cloudflare 프록시 대역 | `opentask.jaehwankim.dev` → `104.21.74.143`, `172.67.203.142` (Cloudflare anycast) |
| 도메인 등록기관 | Vercel (`vercel domains ls` 확인) | 등록기관과 네임서버는 별개 — 소유권/갱신엔 영향 없음, 네임서버 이전도 필요 없음 |
| wrangler CLI | 로컬에 전역 설치는 안 돼 있으나 `npx wrangler` 4.127.1 사용 가능 | 확인 완료 |

**결론: 이관 난이도 낮음.** 어댑터도 필요 없고, 네임서버도 이미 Cloudflare라 이번 단계는
"Cloudflare 존 안에서 오리진을 Vercel → Workers로 바꾸는" 정도의 작업이다.

### 열린 질문 → 확인 완료 (Cloudflare DNS 레코드 스크린샷 기준)

Cloudflare DNS 존(`jaehwankim.dev`, 15/200 레코드) 실제 내용 확인함:

| Name | Type | Content | Proxy |
|---|---|---|---|
| `*.jaehwankim.dev` | A ×2 | `216.198.79.1`, `64.29.17.1` (Vercel IP) | Proxied |
| `jaehwankim.dev` (apex, portfolio) | A ×2 | `64.29.17.65`, `216.198.79.65` | Proxied |
| `www.jaehwankim.dev` | A ×2 | `216.198.79.65`, `216.198.79.1` | Proxied |
| `cam.jaehwankim.dev` | Tunnel | esp32cam (무관) | Proxied |
| `_domainconnect...` | CNAME | Vercel Domain Connect API (무관) | Proxied |
| 메일 관련(MX/TXT: send.mail/resend DKIM/SPF) | — | 무관, 손대지 않음 | DNS only |

**결론: `opentask.jaehwankim.dev` 전용 레코드는 존재하지 않는다.** 지금은 `*.jaehwankim.dev`
와일드카드(→ Vercel)에 얹혀서 응답하고 있을 뿐이다. 반면 apex(portfolio)와 `www`는 각자
전용 A 레코드가 따로 있어 와일드카드와 무관하다.

→ 이관 작업은 "기존 레코드 수정"이 아니라 **`opentask` 전용 레코드를 새로 추가**하는 것으로
바뀐다. DNS는 더 구체적인 레코드가 와일드카드보다 우선하므로, 이 레코드 하나만 생기면
`opentask`만 새 오리진(Cloudflare Workers)으로 가고 portfolio(apex/www)·이메일·`cam.` 터널은
전혀 영향받지 않는다. 롤백도 이 레코드 하나만 지우면 자동으로 와일드카드(Vercel)로 복귀한다.

- 남은 확인: 이 Cloudflare 계정에 Workers 배포 권한이 있는 API 토큰이 있는지 (`wrangler login` 필요할 수 있음)

## 목표 아키텍처

- **Cloudflare Workers (정적 자산)** — Pages보다 최신 권장 경로, `wrangler.jsonc`로 config-as-code
- **배포 방식: Direct Upload.** `vite build`는 로컬/CI에서 실행하고, 결과물(`dist/`)만
  `wrangler deploy`로 업로드. Cloudflare의 Git 연동 자동빌드는 쓰지 않는다.
  - 이유: Git 연동 빌드는 월 500회 제한이 있고 대시보드 설정에 묶임. Direct Upload는 그 제한과
    무관하고, CLI 한 줄로 끝나서 AI 에이전트가 그대로 실행할 수 있다.

## 단계별 계획

1. `website/wrangler.jsonc` 작성 — `name`, `compatibility_date`, `assets.directory = "dist"`
2. `wrangler` devDependency로 추가 (`npm i -D wrangler`) — npx 대신 lockfile에 버전 고정
3. `npm run build && npx wrangler deploy` → 임시 `*.workers.dev` 주소로 1차 배포
4. 8개 페이지(ko/en × index/download/docs/changelog) 전부 직접 열어서 링크·정적 자산 깨짐 없는지 확인
5. 문제 없으면 위 "열린 질문" 확인 후 `opentask.jaehwankim.dev`를 Workers 프로젝트에 커스텀 도메인으로 연결
6. 며칠 병행 운영(Vercel 프로젝트는 그대로 둠) 하며 실사용 확인
7. 이상 없으면 그때 Vercel 쪽 도메인 연결만 해제 (Vercel 프로젝트 삭제는 별도 판단)

## 현재 상태 (2026-08-30)

- 이관 완료. `opentask.jaehwankim.dev`는 Cloudflare Workers(Direct Upload)가 오리진이며,
  최신 빌드(카피/타이포 폴리시 반영본)까지 정상 배포·서빙 확인함.
- **Vercel은 더 이상 배포 대상이 아니다.** 앞으로 website 변경 시 `npx wrangler deploy`만
  실행하면 되고, `npx vercel --prod`는 실행할 필요 없음. Vercel 프로젝트/도메인 연결 자체는
  당장 삭제하지 않고 그대로 둔다(롤백 여지).

## 롤백 계획

- `opentask` 전용 레코드를 삭제하기만 하면 자동으로 기존 `*.jaehwankim.dev` 와일드카드(→Vercel)로
  복귀한다 — 별도로 "되돌리는" 값을 기억하거나 입력할 필요가 없다 (레코드가 없던 원래 상태로
  돌아갈 뿐이라 실수 여지가 적다)
- Vercel 프로젝트는 6번(병행 운영) 끝나기 전까지 절대 삭제하지 않는다
