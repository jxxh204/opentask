---
name: OpenRM
description: 오퍼레이터의 터미널 — 라이트를 기본값으로, 다크를 완전 대응하는 신호 전용 콘솔
colors:
  paper-white: "#f7f7f8"
  surface-white: "#ffffff"
  surface-tint: "#f1f1f3"
  surface-hover: "#e9e9ec"
  ink-black: "#16171a"
  readout-gray: "#55565c"
  ghost-gray: "#8a8b91"
  rail-line: "#e4e4e7"
  divider-line: "#d6d7db"
  signal-violet: "#6d5be8"
  signal-violet-tint: "rgba(109, 91, 232, 0.1)"
  link-blue: "#2f6fe0"
  link-blue-tint: "rgba(47, 111, 224, 0.1)"
  progress-green: "#1f9d6c"
  progress-green-tint: "rgba(31, 157, 108, 0.1)"
  caution-amber: "#b9791a"
  caution-amber-tint: "rgba(185, 121, 26, 0.12)"
  alert-red: "#c94840"
  alert-red-tint: "color-mix(in srgb, #c94840 16%, transparent)"
  function-cyan: "#1a8fa0"
  rail-bezel: "#08080a"
  panel-bezel: "#0d0d10"
typography:
  headline:
    fontFamily: "Pretendard, 'Pretendard Variable', -apple-system, 'Apple SD Gothic Neo', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.2
  title:
    fontFamily: "Pretendard, 'Pretendard Variable', -apple-system, 'Apple SD Gothic Neo', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Pretendard, 'Pretendard Variable', -apple-system, 'Apple SD Gothic Neo', system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.4
  label:
    fontFamily: "Pretendard, 'Pretendard Variable', -apple-system, 'Apple SD Gothic Neo', system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 700
    lineHeight: 1.3
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  chip: "8px"
  control: "9px"
  card: "14px"
  modal: "16px"
  pill: "999px"
  circle: "50%"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
  xxl: "30px"
components:
  button-primary:
    backgroundColor: "{colors.signal-violet}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "34px"
  button-success:
    backgroundColor: "{colors.progress-green}"
    textColor: "#08240f"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "34px"
  button-ghost:
    backgroundColor: "{colors.surface-tint}"
    textColor: "{colors.readout-gray}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "34px"
  chip-violet:
    backgroundColor: "{colors.signal-violet-tint}"
    textColor: "{colors.signal-violet}"
    rounded: "{rounded.chip}"
    padding: "2px 8px"
  chip-blue:
    backgroundColor: "{colors.link-blue-tint}"
    textColor: "{colors.link-blue}"
    rounded: "{rounded.chip}"
    padding: "2px 8px"
  input-text:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink-black}"
    rounded: "9px"
    padding: "0 11px"
    height: "38px"
  card-panel:
    backgroundColor: "{colors.surface-white}"
    rounded: "{rounded.card}"
    padding: "12px 14px"
  modal-panel:
    backgroundColor: "{colors.surface-white}"
    rounded: "{rounded.modal}"
    padding: "24px"
  control-pill:
    backgroundColor: "{colors.surface-tint}"
    textColor: "{colors.ink-black}"
    rounded: "{rounded.pill}"
    height: "34px"
---

# Design System: OpenTask

## Overview

**Creative North Star: "오퍼레이터의 터미널 (The Operator's Terminal)"**

OpenTask는 대시보드가 아니라 콘솔이다. 이 은유는 다크 전용 화면일 때 생긴 것이 아니라, 여러 개의 실제 세션·워크트리·PR을 동시에 주시하고 필요한 순간에만 개입하는 통제실의 태도에서 나온다 — 그래서 라이트가 기본값이 된 지금도 그대로 유효하다. 화면은 밝아졌지만 성격은 바뀌지 않았다: 장식은 없고, 여백은 절제되어 있으며, 색은 오직 상태를 알리기 위해서만 존재한다. **화려한 SaaS 분석 대시보드의 그래디언트·마케팅 광택**과 **귀여운 컨슈머 앱의 일러스트·바운시한 모션**은 라이트 테마와 브라우저-크롬 스타일 pill 컨트롤이 추가된 지금도 여전히 확정된 안티레퍼런스다 — 밝아진 배경과 둥근 pill은 기능적 변화일 뿐, 마케팅적 친근함을 향한 방향 전환이 아니다.

타이포그래피는 인간의 언어(Pretendard)와 기계의 언어(JetBrains Mono)를 명확히 구분해 쓴다. 이름과 설명은 프리텐다드로, 브랜치명·해시·타임스탬프 같은 식별자는 모노스페이스로 전환되며, 이 폰트 전환 자체가 "이건 산문이 아니라 정밀한 값"이라는 신호가 된다.

버튼, 입력, 카드는 담백하지만 단호하다: 라운드는 6~16px 사이에서 억제되고, 완전한 원형은 상태를 나타내는 점과 아바타에만 허용된다 — 단, 주소창·세션 토글 같은 브라우저-크롬 스타일 인터랙티브 컨트롤은 예외적으로 완전한 필(999px)을 쓴다(아래 Shapes 참고). 그림자는 세 곳에서만 쓰인다 — 모달, 도킹된 드로어, 그리고 콘텐츠 위로 뜨는 팝오버/드롭다운 메뉴.

52px 아이콘 레일(ActivityBar)과 200px 컨텍스트 패널은 테마가 라이트든 다크든 항상 거의 완전한 검정(`#08080a`, `#0d0d10`)을 유지한다 — 오퍼레이터가 시선을 두는 작업 표면은 밝아져도, 조종석의 프레임 자체는 항상 어둡다는 시그니처 디테일이다.

**Key Characteristics:**
- 라이트가 기본값, 다크는 완전 대응 — `color-scheme` 3-state 토큰 패턴(bare `:root`=라이트, `prefers-color-scheme`=시스템 다크, `[data-theme]`=명시적 선택)으로 두 팔레트를 동시에 관리
- 색은 오직 신호: violet=에이전트, blue=PR, green=진행, amber=대기, red=실패 — 라이트/다크 모두에서 동일한 역할 매핑
- 인간 언어(Pretendard) vs 기계 언어(JetBrains Mono)의 명확한 register 전환
- 그림자는 "떠 있는" 요소(모달/드로어/팝오버) 세 곳에만, 나머지는 완전히 평평
- 데이터 칩·배지·태그는 6~9px로 억제, 완전한 필은 없음 — 단 브라우저-크롬형 인터랙티브 컨트롤(주소창·토글)은 999px 필 허용
- ActivityBar/ContextPanel은 테마 무관 고정 다크 베젤 — "조종석은 항상 어둡다"
- 모션은 색/투명도 전환(0.12s)과 회전(0.15s)뿐 — 들어올리거나 확대하는 모션 없음

## Colors

팔레트는 거의 무채색이다 — 배경과 표면은 라이트/다크 모두 그레이스케일이고, 오직 6개의 시그널 색만 의미를 나른다. 아래 각 색은 **라이트(기본값) / 다크** 순으로 표기한다.

### Primary (Signal Palette)
- **시그널 바이올렛 Signal Violet** (라이트 `#6d5be8` / 다크 `#8b7cf0`): 에이전트 / 선택 상태 / 직렬 체인의 신호색. 시스템 전역의 기본 링크(anchor) 색이기도 하다.
- **링크 블루 Link Blue** (라이트 `#2f6fe0` / 다크 `#579dff`): PR과 외부 링크 전용. tint 배경과 짝을 이뤄 칩/배지에 쓰인다.
- **프로그레스 그린 Progress Green** (라이트 `#1f9d6c` / 다크 `#3ecf8e`): 진행 중 / 성공 / 병렬 실행.
- **코션 앰버 Caution Amber** (라이트 `#b9791a` / 다크 `#e0a436`): 대기 / 주의.
- **얼럿 레드 Alert Red** (라이트 `#c94840` / 다크 `#e0655c`): 실패 / 삭제.

각 시그널 색은 전용 tint 파생 토큰을 갖는다: `--vtint`/`--btint`/`--gtint`/`--atint`(라이트는 10~12% 알파, 다크는 16~18% 알파 — 다크에서 배경이 어두운 만큼 틴트를 더 진하게 준다). `--rtint`만 예외로 `color-mix(in srgb, var(--red) 16%, transparent)`로 정의된 파생값이다 — 테마가 바뀌어도 별도 재정의 없이 항상 현재 `--red`를 따라간다.

### Tertiary
- **펑션 시안 Function Cyan** (라이트 `#1a8fa0` / 다크 `#28c0d4`): 아키텍처 그래프의 함수 노드 전용 색 — 6색 신호 체계의 유일한 단일 목적 확장.

### Neutral
- **페이퍼 화이트 Paper White** (라이트 `#f7f7f8` / 다크 딥 콘솔 블랙 `#1a1b1f`): 앱 배경.
- **서피스 화이트 Surface White** (라이트 `#ffffff` / 다크 `#212227`): 기본 표면(카드/패널).
- **서피스 틴트 Surface Tint** (라이트 `#f1f1f3` / 다크 `#26272d`): 패널 헤더 / 보조 표면.
- **서피스 호버 Surface Hover** (라이트 `#e9e9ec` / 다크 `#2c2d33`): 호버 상태 표면.
- **잉크 블랙 Ink Black** (라이트 `#16171a` / 다크 터미널 화이트 `#ededf0`): 기본 텍스트.
- **리드아웃 그레이 Readout Gray** (라이트 `#55565c` / 다크 `#a5a5ac`): 보조 텍스트, body의 기본색.
- **고스트 그레이 Ghost Gray** (라이트 `#8a8b91` / 다크 `#7d7e86`): 3차 텍스트 — placeholder에 가까운 muted 값.
- **레일 라인 Rail Line** (라이트 `#e4e4e7` / 다크 `#2f3037`): 구조적 구분선 — 헤더/푸터/레일 경계.
- **디바이더 라인 Divider Line** (라이트 `#d6d7db` / 다크 `#393a42`): 컴포넌트 기본 보더 — 카드/입력/버튼.
- **레일 베젤 Rail Bezel** (`#08080a`, 테마 무관): ActivityBar 배경 전용 — 라이트/다크 어느 쪽에서도 재정의되지 않는다.
- **패널 베젤 Panel Bezel** (`#0d0d10`, 테마 무관): ContextPanel 배경 전용 — 같은 이유로 고정.

### Named Rules
**The Signal-Only Rule.** 색은 오직 상태 신호로만 쓰인다 — violet/blue/green/amber/red는 각각 에이전트/PR/진행/대기/실패에 1:1로 고정 매핑되며, 브랜딩 장식이나 임의의 강조색으로 확장되지 않는다. 이 매핑은 라이트/다크 두 팔레트 모두에서 동일하게 지켜진다.

## Typography

**Body Font:** Pretendard (with 'Pretendard Variable', -apple-system, 'Apple SD Gothic Neo', system-ui, sans-serif)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, Menlo, monospace)

**Character:** 두 폰트는 역할로 분리된 두 개의 목소리다 — Pretendard는 사람이 쓰는 이름·설명·안내 문구를, JetBrains Mono는 브랜치명·해시·포트·타임스탬프 같은 기계가 만든 식별자를 담는다. 히어로급 디스플레이 텍스트는 없다: Operate 모드 도구이므로 페이지 제목이 타이포그래피 계층의 최상단이다. 라이트/다크 전환은 색만 바꿀 뿐 이 위계·크기·굵기 체계에는 영향을 주지 않는다.

### Hierarchy
- **Headline** (weight 800, 20–21px, line-height ~1.2): 페이지 최상단 제목 — 아키텍처/GitHub/모니터/설정 페이지의 H1.
- **Title** (weight 700–800, 13–16px, line-height ~1.3): 패널/섹션/모달 제목, 카드 이름 입력 필드.
- **Body** (weight 500–600, 11–12.5px, line-height ~1.4): 시스템 전반의 기본 UI 텍스트 — 행 이름, 버튼, 힌트, 대부분의 인터페이스 문구.
- **Label** (weight 700, 9.5–10.5px): 메타 정보 — 타임스탬프, 파일 경로, 배지, 카운터.
- **Mono** (JetBrains Mono, ~10.5–12px, `.m` 클래스): 브랜치명, 커밋 해시, 포트 번호, 로그성 타임스탬프.

### Named Rules
**The Register Switch Rule.** 이름과 설명은 Pretendard로, 식별자(브랜치명·해시·포트·타임스탬프)는 JetBrains Mono로 전환된다. 폰트가 바뀌는 순간 그 값이 "산문이 아니라 정밀한 데이터"임을 알린다.

## Layout

레이아웃은 고정폭 레일 + 콘텐츠 구조다: 52px 아이콘 레일(ActivityBar)이 항상 왼쪽에 붙고, 필요 시 200px 고정폭 컨텍스트 패널이 도킹된다 — 뷰포트에 맞춰 유동적으로 리사이즈되지 않는다. **예외: Sessions(개발실)** — 터미널 중심 프로토타입을 그대로 이식한 SessionShell이 ActivityBar/ContextPanel 없이 전체 화면을 직접 쓴다(300px 고정폭 사이드바 워크트리 트리 + 탭 워크스페이스). Debug/GitHub/Monitor/Architecture/Setup은 기존 듀얼레일 구조 그대로 유지. 데스크톱 전용 로컬 오퍼레이터 도구라는 제품 성격과 일치하며(브라우저 dev server, 또는 동일 코드를 그대로 구동하는 Electron 데스크톱 셸), 반응형 브레이크포인트는 관찰되지 않는다.

내부 리듬은 6/8/10/12/14/16px 사이에서 촘촘하게 움직이고, 페이지 헤더 같은 섹션 단위에서는 18~30px로 벌어진다(예: `padding: 22px 30px 18px`, `padding: 26px 30px 70px`). 8의 배수를 엄격히 따르는 그리드가 아니라, 9px/11px/13px 같은 반칸 값이 자연스럽게 섞이는 "눈으로 맞춘" 밀도다. 페이지 컨테이너는 840/900/1120px 중 하나의 max-width로 중앙 정렬된다.

### Named Rules
**The Fixed-Dock Rule.** 레일과 컨텍스트 패널은 고정폭으로 도킹되며 뷰포트에 맞춰 리사이즈되지 않는다 — 반응형 웹앱이 아니라 데스크톱 오퍼레이터 콘솔이다.
**The Fixed-Bezel Rule.** ActivityBar(`#08080a`)와 ContextPanel(`#0d0d10`)은 라이트/다크 테마 전환과 무관하게 항상 같은 값을 쓴다 — 작업 표면은 테마를 따르지만, 그 표면을 감싸는 프레임(레일)은 항상 어둡다. 오퍼레이터가 앉은 조종석 자체는 테마의 대상이 아니라는 의도된 시그니처다.

## Elevation & Depth

이 시스템은 기본적으로 완전히 평평하다(flat). 카드, 버튼, 드롭다운, 배지 어디에도 그림자가 없다 — 깊이는 표면색(서피스 화이트 vs 페이퍼 화이트, 다크에서는 그 반대 방향의 명도 대비)과 1px 보더만으로 표현된다. 그림자는 정확히 세 곳, 콘텐츠 위로 물리적으로 "떠 있는" 요소에만 등장한다: 모달 패널, 도킹된 인스펙터 드로어, 그리고 팝오버/드롭다운 메뉴(레포 피커, 인박스 패널, 탭 컨텍스트 메뉴, cmdk 팔레트, env 패널, 오버플로 메뉴).

### Shadow Vocabulary
- **모달 플로트** (`box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5)`): 화면 중앙에 뜨는 모달 패널.
- **드로어 플로트** (`box-shadow: -16px 0 40px rgba(0, 0, 0, 0.4)`): 오른쪽에서 슬라이드인하는 인스펙터 드로어 — 그림자가 왼쪽으로 드리워진다(도킹 방향과 반대).
- **팝오버 플로트** (`box-shadow: 0 20px 44px rgba(0, 0, 0, 0.35~0.5)`): 클릭으로 열리는 작은 메뉴/패널류 — 모달보다 가볍고 좁은 반경.

### Named Rules
**The Flat-Console Rule.** 표면은 정지 상태에서 항상 완전히 평평하다. 그림자는 오직 콘텐츠 평면 위로 물리적으로 떠 있는 요소(모달·드로어·팝오버) 세 곳에만 등장하며, 카드나 버튼을 장식하는 용도로는 절대 쓰이지 않는다.

## Shapes

라운드는 두 층으로 나뉜다: 대부분의 표면·컨트롤은 억제된 범위(6~16px) 안에서만 움직이고, **주소창·세션/녹화 버튼·디바이스 토글·설정 토글 같은 브라우저-크롬 스타일 인터랙티브 컨트롤**만 예외적으로 완전한 필(999px)을 쓴다. 데이터를 나타내는 요소(칩·배지·태그·카운터)는 이 예외에서 제외된다 — '칩'이라는 이름이 붙은 요소는 실제로도 6~9px의 소프트 코너를 벗어나지 않는다. 완전한 원형(50%)은 상태 점·아바타·상태 아이콘(FolderCard/TaskRow, 아래 Components 참고)에 허용된다.

보더는 두 단계로 나뉜다: `var(--line)`은 레일/헤더/푸터 같은 구조적 경계에, `var(--line2)`은 카드·입력·버튼의 기본 테두리에 쓰인다. 점선(`1px dashed var(--line2)`)은 기본적으로 "여기를 클릭해 추가하라"는 전용 신호다 — RepoTable/EnvVarTable의 추가 버튼, SessionsPage의 폴더 추가 버튼, ConnectorCard의 빈 슬롯이 이 규칙을 따른다. **유일한 예외**: FolderCard의 taskBody 들여쓰기(`border-left: 1px dashed var(--line)`)는 "추가" 신호가 아니라 순수한 들여쓰기 마커다 — 트리 구조의 자식 항목을 시각적으로 안쪽으로 밀어 넣는 용도로 명시적으로 규칙 밖에 둔다.

### Named Rules
**The Scoped-Pill Rule.** 완전한 필(999px)은 브라우저-크롬 스타일 인터랙티브 컨트롤(주소창, 세션/녹화 버튼, 디바이스 토글, 설정 토글)에만 허용된다. 데이터 칩·배지·태그는 예외 없이 6~9px를 지킨다 — 이 둘을 섞으면 "실제 상태 정보"와 "조작 가능한 컨트롤"의 구분이 무너진다.
**The Dashed-Means-Add Rule.** 점선 보더는 원칙적으로 "클릭해서 추가하라"는 빈 슬롯 신호로만 쓰인다 — 유일한 명시된 예외는 FolderCard의 taskBody 들여쓰기.

## Components

### Buttons
- **Shape:** 라운드 8–9px, 높이 30–36px.
- **Primary (violet):** 배경 시그널 바이올렛, 텍스트 흰색, 보더 없음, weight 700.
- **Success (green):** 배경 프로그레스 그린, 텍스트는 어두운 그린(#08240f) — 밝은 배경엔 어두운 텍스트로 대비를 확보한다(라이트/다크 공통 — 그린 자체가 두 테마 모두 상대적으로 밝은 값이라 이 조합이 유지된다).
- **Ghost / Secondary:** 배경 서피스 틴트, 1px 디바이더 라인 보더, 텍스트 리드아웃/고스트 그레이.
- **Icon buttons:** 24–30px 정사각, 라운드 6–8px, 기본 투명 배경. 파괴적 액션은 호버 시 얼럿 레드 14–16% tint로 전환.
- **Disabled:** `opacity: 0.5; cursor: default`.

### Named Rules
**The No-Lift Rule.** 버튼 호버는 색/배경을 0.12s로 스왑하거나 얇은 화살표를 0.15s로 회전시킬 뿐, 들어올리거나(translateY) 확대되지(scale) 않는다.

### Browser-Chrome Controls (신규)
BrowserPane(내장 브라우저 프리뷰)의 툴바가 실제 브라우저 크롬처럼 보이도록 의도적으로 이 시스템 안에서 유일하게 pill을 쓴다.
- **주소창(`.addressBar`) / 세션·녹화 버튼(`.sessionBtn`) / 디바이스 토글(`.deviceToggle`, `.deviceOpt`):** 라운드 999px, 활성 상태는 시그널 바이올렛 틴트.
- **아이콘 버튼:** 28px 정사각, 라운드 7px(pill 아님 — 정사각형 버튼은 일반 컨트롤 규칙을 따른다).
- SettingsModal의 테마 토글도 같은 pill 언어를 공유한다: 세그먼트형 999px 트랙 + 활성 세그먼트 시그널 바이올렛.

### Chips & Badges
- tint 배경 + 동일 색조 텍스트 조합(예: 시그널 바이올렛 tint bg + 시그널 바이올렛 텍스트, 링크 블루 tint bg + 링크 블루 텍스트).
- 대부분의 마이크로 라벨은 tint 배경 없이 상태색 텍스트만 쓴다(ok=green, warn=amber, err=red).
- 라운드 6–9px, **필 없음 — 예외 없음**(Shapes의 Scoped-Pill Rule 참고). 알림 카운터 배지는 원형에 가까운 8px 라운드, 배경 얼럿 레드.

### Cards & Rows
- **FolderCard / TaskRow (재설계됨):** 더 이상 보더가 있는 "카드"가 아니라 평평한 트리 노드다. `.head`는 호버 시 서피스 호버, 선택 시 시그널 바이올렛 틴트 배경의 행(라운드 6–8px). 상태는 더 이상 카드 테두리 색으로 표시되지 않는다 — **16px 원형 상태 아이콘**(진행 중=바이올렛 틴트 배경+바이올렛 아이콘, 대기=앰버 틴트 배경+앰버 아이콘)이 그 역할을 대신한다. 아카이브는 호버로만 노출되는 아이콘 버튼이며, 클릭 시 얼럿 레드 틴트 배경의 확인 칩으로 확장된다. TaskRow는 6px 라운드, 상태는 13px 점으로 표시.
- **RepoTable:** 기본 카드 라운드(14px), 1px 디바이더 라인 보더, 행 구분은 하단 보더(마지막 행은 제거), 별도 행 호버 배경 없음 — 삭제 아이콘만 호버 시 반응.
- **Popover / Dropdown Panel (신규):** 레포 피커, 인박스 패널, 탭 컨텍스트 메뉴, cmdk 팔레트, env 패널, 오버플로 메뉴가 공유하는 패턴 — 서피스 틴트 배경, 디바이더 라인 보더, 카드와 동일한 14px 라운드, 팝오버 플로트 그림자.

### Named Rules
**The Status-Icon Rule.** 작업/태스크의 진행 상태는 카드 테두리 색조가 아니라 전용 원형 상태 아이콘(FolderCard: 16px, TaskRow: 13px)과 행 배경 틴트로 표현한다. 카드/행 자체의 테두리는 상태와 무관하게 고정이다.

### Inputs
- **Style:** 높이 38px, 라운드 9px, 배경 페이퍼 화이트, 1px 디바이더 라인 보더, 폰트 12.5px.
- **Focus:** 보더가 시그널 바이올렛으로 전환.
- **Placeholder:** `#5a5a62` — 고정값(테마 무관, 리드아웃/고스트 그레이보다 한 톤 어두운 전용 값).

### Modal & Drawer
- **Modal:** 오버레이 `rgba(6, 7, 9, 0.64)` + `backdrop-filter: blur(3px)`. 패널은 서피스 화이트 배경, 1px 디바이더 라인 보더, 라운드 16px, 모달 플로트 그림자, 최대 높이 86vh.
- **InspectorDrawer:** 오른쪽에서 도킹(400px), 드로어 플로트 그림자(왼쪽으로 드리움). 진입 트랜지션에서 시스템 전체에서 유일하게 named easing을 쓴다(`transform 0.26s cubic-bezier(0.4, 0, 0.2, 1)`).

### Navigation
- **ActivityBar:** 52px 고정 레일(배경 레일 베젤 `#08080a`, 테마 무관), 40×40px 아이콘 버튼, 라운드 10px. 비활성은 리드아웃 그레이, 호버는 서피스 틴트 배경, 활성은 시그널 바이올렛 tint 배경 + 시그널 바이올렛 아이콘 색 + 왼쪽 3px 바이올렛 액센트 바(`border-radius: 0 2px 2px 0`)의 3중 신호.
- **ContextPanel:** 200px 고정폭(배경 패널 베젤 `#0d0d10`, 테마 무관), 행 높이 32px 라운드 7px, 호버만 존재(별도 활성색 없음).

### Signal Rail (BranchChain)
이 시스템에서 유일하게 절대 위치 기반 타임라인 지오메트리를 쓰는 시그니처 컴포넌트. 2px 세로 레일 위에 13×13px 원형 노드(2px 고스트 그레이 보더 + 서피스 화이트 배경)가 커밋/브랜치를 표시하고, 14×2px 가로 tick이 포크 지점을 나타낸다. 각 브랜치는 서피스 화이트 카드(라운드 9px)로 렌더링되며, 관련 링크는 6px 라운드의 소형 칩으로 붙는다.

### Orchestrator Pane / Inbox (재구성됨)
과거 독립 컴포넌트였던 OrchestratorBar와 InboxSection은 각각 다른 형태로 흡수됐다. **Orchestrator**는 이제 사이드바가 아니라 SessionShell의 워크스페이스 탭 중 하나(패널)로 존재하며, 28px 높이·7px 라운드의 `.btn`/`.btnPrimary` 컨트롤과, 에이전트 간 메시지를 보여주는 피드(`kind_*` 배지가 바이올렛/블루/레드 틴트로 종류를 구분)로 구성된다. **인박스**는 더 이상 별도 섹션이 아니라 SessionShell 사이드바 헤더에 붙는 트리거 버튼(`.inboxTrigger`)이 여는 인라인 패널(`.inboxPanel`)이다 — Popover/Dropdown Panel 패턴을 그대로 따른다.

### GitHub Connect & AWS MFA (신규)
- **GitHub Connect:** gh CLI 위임과 OAuth Device Flow 두 경로를 모두 제공하는 온보딩 버튼. Primary(violet) 버튼 + 디바이스 코드를 보여주는 서피스 틴트 배경의 보더 박스. 상태 텍스트는 tint 배경 없이 색상만 쓴다(연결됨=green, 대기=amber, 실패=red) — 마이크로 라벨 규칙과 동일.
- **AWS MFA Panel:** 표준 카드(14px 라운드, 서피스 화이트 배경) 안에 MFA 코드 입력 필드 + 시그널 바이올렛 "갱신" 버튼(8px 라운드).

## Do's and Don'ts

### Do:
- **Do** 라이트/다크 두 테마 모두 토큰 레벨에서 관리한다 — 컴포넌트는 항상 `var(--x)`를 통해서만 색을 쓰고, 미디어 쿼리나 `[data-theme]` 블록 안에 직접 색을 선언하지 않는다.
- **Do** 색은 오직 신호로만 쓴다 — violet/blue/green/amber/red를 정해진 의미 밖으로 확장하지 않는다.
- **Do** 그림자는 모달/드로어/팝오버처럼 콘텐츠 위로 뜨는 요소에만 쓴다.
- **Do** 식별자(브랜치명/해시/포트/타임스탬프)는 JetBrains Mono로 전환한다.
- **Do** 점선 보더는 "클릭해서 추가" 신호로 쓴다 — FolderCard의 들여쓰기 용도 외에는 예외를 늘리지 않는다.
- **Do** 완전한 필(999px)은 주소창·토글 같은 브라우저-크롬형 인터랙티브 컨트롤에만 쓴다.
- **Do** 진행 상태는 카드 보더가 아니라 전용 상태 아이콘 + 행 배경 틴트로 표시한다.
- **Do** ActivityBar/ContextPanel의 고정 다크 베젤(`#08080a`/`#0d0d10`)은 테마 전환과 무관하게 유지한다.

### Don't:
- **Don't** 화려한 SaaS 대시보드처럼 그래디언트나 마케팅용 광택 표면을 넣지 않는다.
- **Don't** 귀여운 컨슈머 앱처럼 일러스트나 바운시한 모션을 넣지 않는다.
- **Don't** 데이터 칩/배지/태그를 완전한 필(999px) 모양으로 만들지 않는다 — pill은 인터랙티브 컨트롤 전용이다.
- **Don't** 호버에 translateY나 scale 같은 "들어올리는" 모션을 쓰지 않는다.
- **Don't** 카드나 버튼에 장식용 그림자를 얹지 않는다.
- **Don't** 카드/행의 테두리 색으로 진행 상태를 표시하지 않는다 — 상태 아이콘의 역할이다.
