# OpenTask 소개 웹사이트

랜딩 페이지 + 다운로드 페이지 + Docs. 정적 HTML/CSS/JS를 Vite로 빌드하는 멀티페이지 사이트입니다
(프레임워크 없음). 디자인 토큰은 [`../app/src/styles/theme.css`](../app/src/styles/theme.css)와
같은 체계를 공유합니다 — 앱과 동일한 라이트/다크·시맨틱 컬러·폰트(Pretendard + JetBrains Mono).

## 로컬 실행

```bash
cd website
npm install
npm run dev       # http://localhost:5173
```

## 빌드 / 배포

```bash
npm run build      # dist/ 에 index.html, download.html, docs.html, changelog.html 정적 산출물 생성
npm run preview    # 빌드 결과 로컬 미리보기
```

Vercel에 배포할 경우 Root Directory를 `website`로 지정하면 됩니다(Framework Preset: Vite).

## 페이지 구성

| 파일 | 내용 |
|---|---|
| `index.html` | 랜딩 — 히어로, 포지셔닝, 기능, 워크플로, 원칙, OSS |
| `download.html` | 다운로드 — 정식 빌드 준비 중 상태 + 소스 빌드 가이드 |
| `docs.html` | Docs — 사이드바 내비게이션 단일 페이지(개요/퀵스타트/설치/핵심개념/기능별 사용 방법 10종/기능 요약/설정/보안/FAQ/기여) |
| `changelog.html` | 릴리스 노트 — 버전별 변경사항. 정식 릴리스 전까지는 사전 기능 요약 하나만 표시 |

## 다운로드 활성화하기 (다음 라운드)

지금은 `download.html`의 다운로드 버튼이 `aria-disabled`로 비활성화되어 있습니다(정식 빌드가 아직
없기 때문 — 없는 파일을 있는 것처럼 안내하지 않기 위한 의도적 상태). 실제 배포를 켜려면:

1. **Apple 서명/공증** — `app/package.json`의 `build.mac`에 `hardenedRuntime`, `entitlements`,
   `notarize` 설정을 추가하고 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`(또는
   App Store Connect API 키)를 환경변수로 준비합니다. `@electron/notarize`를 `electron-builder`
   afterSign 훅으로 연결합니다.
2. **빌드** — `cd app && npm run electron:build` → `app/release/`에 서명·공증된 `.dmg`/`.zip` 생성.
3. **릴리스 게시** — `cd app && npx electron-builder --publish always` (또는 빌드 후
   `gh release create`)로 GitHub Releases에 `.dmg`/`.zip` + `latest-mac.yml` 업로드.
   `download.html`의 두 `<a class="btn ...">` href를 실제 릴리스 다운로드 URL로 교체, `aria-disabled`
   속성 제거.
4. **체크섬** — 업로드한 파일의 `shasum -a 256`을 다운로드 페이지에 함께 표기하는 것을 권장.

## 자동 업데이트 (이미 연결됨)

`app/electron/main.cjs`에 `electron-updater`가 연결되어 있습니다 — 패키징된 앱(`app.isPackaged`)이
켜질 때마다 `package.json`의 `build.publish`(GitHub Releases, `jxxh204/opentask`)를 확인해 새 버전이
있으면 백그라운드로 받아 OS 알림으로 안내하고, 클릭 시 재시작하며 적용합니다. 개발 모드
(`electron:dev`)에서는 아예 실행되지 않습니다.

- macOS의 Squirrel.Mac은 **서명된 앱에만** 업데이트 설치를 허용합니다 — 위 1번(Apple 서명/공증)이
  끝나기 전까지는 체크는 돌아가되 조용히 실패합니다(앱 크래시 없음).
- 새 버전을 낼 때마다 3번처럼 `--publish always`로 올리기만 하면 이미 설치된 사용자에게 자동으로
  전파됩니다 — 별도 업데이트 서버 구축 불필요.
