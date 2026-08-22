import { useEffect, useState } from 'react'
import { useSetupStore } from '../store/useSetupStore'
import { setSentryConfig } from '../api/sentry'
import OnboardingStep, { type OnboardingStepVM } from '../components/onboarding/OnboardingStep'
import EnvVarTable from '../components/onboarding/EnvVarTable'
import GithubConnectButtons from '../components/onboarding/GithubConnectButtons'
import ProgressBar from '../components/common/ProgressBar'
import styles from './SetupPage.module.css'

interface StepDef {
	id: string
	logo: string
	color: string // "r,g,b" for rgba()
	title: string
	tag: string
	req: 0 | 1
	used: string
	cta: string
	hint: string
	fieldDefs: { key: string; label: string; ph: string; folderKind?: 'root' | 'worktree' }[]
	note?: string
	doneLabel?: string
}

const TMUX_INSTALL_NOTE = `macOS:         brew install tmux
Ubuntu/Debian: sudo apt install tmux
Fedora/RHEL:   sudo dnf install tmux
Windows:       WSL 안에서 위 Linux 명령 사용

개발실의 오케스트레이션과 실터미널(디버깅 등)이 전부 tmux로 동작합니다.`

// 'paths'와 'tmux'는 특수 처리된다: 'paths'는 rootPath/wtPath/branchPrefix로 직접 매핑되고
// (다른 페이지의 온보딩 게이트가 읽는 필드), 'tmux'는 필드를 저장하는 커넥터가 아니라
// 설치 여부를 재확인하는 환경 점검 스텝이다. 나머지는 connectors[id].fields에 일반 저장.
const STEPS: StepDef[] = [
	{
		id: 'tmux',
		logo: 'https://cdn.simpleicons.org/gnubash/ededf0',
		color: '62,207,142',
		title: '터미널 (tmux)',
		tag: '개발실 · 디버깅',
		req: 1,
		used: '오케스트레이션·실터미널 실행에 필요',
		cta: '다시 확인',
		hint: '설치 후 다시 확인을 눌러주세요',
		note: TMUX_INSTALL_NOTE,
		doneLabel: '설치됨',
		fieldDefs: [],
	},
	{
		id: 'dev',
		logo: 'https://cdn.simpleicons.org/react/61dafb',
		color: '139,124,240',
		title: '개발 서버',
		tag: '디버깅',
		req: 1,
		used: '디버깅 · 화면명령에서 사용',
		cta: '등록',
		hint: '주소만 등록하면 됩니다 · 연결 확인 없음',
		fieldDefs: [
			{ key: 'devServerUrl', label: 'dev 서버 URL', ph: 'http://localhost:3000' },
			{ key: 'webviewPort', label: '웹뷰 포트 (선택)', ph: '5040' },
		],
	},
	{
		id: 'github',
		logo: 'https://cdn.simpleicons.org/github/ededf0',
		color: '87,157,255',
		title: 'GitHub',
		tag: 'GitHub · 내 PR',
		req: 1,
		used: 'GitHub 작업률 · 내 PR · 플릿에서 사용 — 실제 조회는 전부 gh CLI로 동작',
		cta: '레포 저장',
		hint: '인증은 아래 두 버튼 중 하나로',
		fieldDefs: [{ key: 'repo', label: '레포', ph: 'owner/repo' }],
	},
	{
		id: 'db',
		logo: 'https://cdn.simpleicons.org/supabase/3ecf8e',
		color: '155,130,232',
		title: 'DB (Supabase / Postgres)',
		tag: '아키텍처',
		req: 1,
		used: '아키텍처 · API 매핑에서 사용',
		cta: '연결 · introspect',
		hint: '스키마 자동 분석',
		fieldDefs: [
			{ key: 'connString', label: '연결 문자열', ph: 'postgresql://…  또는  https://xxx.supabase.co' },
			{ key: 'schema', label: '스키마', ph: 'public' },
		],
	},
	{
		id: 'paths',
		logo: 'https://cdn.simpleicons.org/git/f14e32',
		color: '224,101,92',
		title: '프로젝트 · 워크트리 위치',
		tag: '개발실 · 플릿',
		req: 1,
		used: '개발실 · 플릿 — git 워크트리 생성 기준',
		cta: '경로 저장',
		hint: '각 태스크가 격리 작업장으로 clone됨',
		fieldDefs: [
			{ key: 'rootPath', label: '프로젝트 루트 (기본 레포)', ph: '~/projects/openrm', folderKind: 'root' },
			{ key: 'wtPath', label: '워크트리 생성 위치', ph: '~/projects/.worktrees', folderKind: 'worktree' },
			{ key: 'branchPrefix', label: '브랜치 prefix (선택)', ph: 'GBIZ-' },
			{ key: 'ticketPrefix', label: '티켓 접두사 (선택)', ph: 'GBIZ · 미설정 시 PROJ' },
		],
	},
	{
		id: 'app',
		logo: 'https://cdn.simpleicons.org/nextdotjs/ededf0',
		color: '62,207,142',
		title: '프로젝트 루트 (API · Next.js)',
		tag: '아키텍처 · 개발실',
		req: 1,
		used: '아키텍처 스캔 · 개발실 워크트리에서 사용',
		cta: '스캔',
		hint: 'features · app 라우터 탐색',
		fieldDefs: [
			{ key: 'apiRoot', label: 'features 루트', ph: 'src/features' },
			{ key: 'nextRoot', label: 'Next.js app 루트', ph: 'src/app' },
		],
	},
]

const OPTS: StepDef[] = [
	{
		id: 'sentry',
		logo: 'https://cdn.simpleicons.org/sentry/e0655c',
		color: '224,101,92',
		title: 'Sentry',
		tag: '모니터',
		req: 0,
		used: '모니터 — JS 에러·이슈 추적',
		cta: '연결',
		hint: 'Auth Token (Settings → Auth Tokens, project:read)',
		fieldDefs: [
			{ key: 'token', label: 'Auth Token', ph: 'sntryu_••••••••••••' },
			{ key: 'org', label: 'Organization slug', ph: 'my-org' },
			{ key: 'project', label: 'Project slug (선택)', ph: 'my-project' },
		],
	},
	{
		id: 'aws',
		logo: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/amazonwebservices/amazonwebservices-original-wordmark.svg',
		color: '224,164,54',
		title: 'AWS · 배포',
		tag: '모니터',
		req: 0,
		used: '모니터 — 배포·CloudFront 상태',
		cta: '연결',
		hint: '배포 파이프라인 웹훅',
		fieldDefs: [{ key: 'webhook', label: '배포 웹훅 / 리전', ph: 'ap-northeast-2' }],
	},
	{
		id: 'vitals',
		logo: 'https://cdn.simpleicons.org/lighthouse/579dff',
		color: '87,157,255',
		title: 'Web Vitals',
		tag: '모니터',
		req: 0,
		used: '모니터 — LCP·INP·CLS',
		cta: '연결',
		hint: 'RUM 수집 엔드포인트',
		fieldDefs: [{ key: 'endpoint', label: '수집 엔드포인트', ph: '/api/vitals' }],
	},
	{
		id: 'slack',
		logo: 'https://cdn.simpleicons.org/slack/ececec',
		color: '62,207,142',
		title: 'Slack 장애 알림',
		tag: '모니터',
		req: 0,
		used: '모니터 — 장애 채널 읽어 알림 인박스·자동 업무전환',
		cta: '연결',
		hint: '알림이 올라오는 채널의 ID',
		fieldDefs: [{ key: 'channelId', label: 'Slack 채널 ID', ph: 'C0123456789' }],
	},
	{
		id: 'slackSign',
		logo: 'https://cdn.simpleicons.org/slack/ececec',
		color: '62,207,142',
		title: 'Slack 웹훅 서명',
		tag: '모니터',
		req: 0,
		used: '/api/slack/events 인바운드 요청 서명 검증 — 미설정 시 원격 요청은 거부(fail-closed)',
		cta: '저장',
		hint: 'Slack 앱 Basic Information → Signing Secret',
		fieldDefs: [{ key: 'secret', label: 'Signing Secret', ph: '8f3a2•••••••••••••' }],
	},
	{
		id: 'notion',
		logo: 'https://cdn.simpleicons.org/notion/ececec',
		color: '155,130,232',
		title: 'Notion 백로그 자동생성',
		tag: '개발실',
		req: 0,
		used: '티켓 없는 업무를 Notion 카드로 자동 생성(개발실 흐름 중 호출) — Notion MCP 연결 필요',
		cta: '저장',
		hint: '백로그 데이터베이스 ID + 고정 필드값',
		fieldDefs: [
			{ key: 'db', label: 'Notion DB ID', ph: '32자리 hex' },
			{ key: 'assignee', label: '작업자(담당자)', ph: '자기 이름' },
			{ key: 'service', label: '서비스 (선택)', ph: 'my-service' },
			{ key: 'platform', label: '플랫폼 (선택)', ph: 'web' },
		],
	},
	{
		id: 'deploy',
		logo: 'https://cdn.simpleicons.org/git/f14e32',
		color: '224,101,92',
		title: '정기배포 브랜치',
		tag: '개발실',
		req: 0,
		used: 'deploy-<번호> 브랜치 생성·조회·삭제 (플릿 팝업)',
		cta: '저장',
		hint: '배포 대상 레포 + 기준 브랜치',
		fieldDefs: [
			{ key: 'repo', label: '레포', ph: 'owner/repo' },
			{ key: 'base', label: '기준 브랜치 (선택)', ph: '미설정 시 develop' },
		],
	},
	{
		id: 'operator',
		logo: 'https://cdn.simpleicons.org/googlegemini/8b7cf0',
		color: '139,124,240',
		title: '운영자 이름',
		tag: '개발실',
		req: 0,
		used: 'AI 리뷰 브리핑·지휘 프롬프트에서 이 이름으로 호칭 (예: "{이름}가 이 변경을 직접 리뷰해")',
		cta: '저장',
		hint: '미설정 시 "운영자"로 표시',
		fieldDefs: [{ key: 'name', label: '이름', ph: '마티' }],
	},
]

const ALL = [...STEPS, ...OPTS]

export default function SetupPage() {
	const [open, setOpen] = useState<string | null>('tmux')
	const connectors = useSetupStore((s) => s.connectors)
	const setConnector = useSetupStore((s) => s.setConnector)
	const syncConnector = useSetupStore((s) => s.syncConnector)
	const hydrate = useSetupStore((s) => s.hydrate)
	const rootPath = useSetupStore((s) => s.rootPath)
	const wtPath = useSetupStore((s) => s.wtPath)
	const branchPrefix = useSetupStore((s) => s.branchPrefix)
	const ticketPrefix = useSetupStore((s) => s.ticketPrefix)
	const setRootPath = useSetupStore((s) => s.setRootPath)
	const setWorktreePath = useSetupStore((s) => s.setWorktreePath)
	const setBranchPrefix = useSetupStore((s) => s.setBranchPrefix)
	const setTicketPrefix = useSetupStore((s) => s.setTicketPrefix)
	const operatorName = useSetupStore((s) => s.operatorName)
	const setOperatorName = useSetupStore((s) => s.setOperatorName)
	const syncOperatorName = useSetupStore((s) => s.syncOperatorName)
	const tmuxAvailable = useSetupStore((s) => s.tmuxAvailable)
	const checkTmuxAvailable = useSetupStore((s) => s.checkTmuxAvailable)

	useEffect(() => {
		hydrate()
	}, [hydrate])

	// 'paths' step reads/writes the dedicated store fields; every other step
	// reads/writes its own generic connectors[id].fields bag.
	const fieldValue = (stepId: string, key: string): string => {
		if (stepId === 'paths') {
			if (key === 'rootPath') return rootPath ?? ''
			if (key === 'wtPath') return wtPath ?? ''
			if (key === 'branchPrefix') return branchPrefix
			if (key === 'ticketPrefix') return ticketPrefix
		}
		if (stepId === 'operator' && key === 'name') return operatorName
		return connectors[stepId]?.fields[key] ?? ''
	}
	const setFieldValue = (stepId: string, key: string, v: string) => {
		if (stepId === 'paths') {
			if (key === 'rootPath') return setRootPath(v)
			if (key === 'wtPath') return setWorktreePath(v)
			if (key === 'branchPrefix') return setBranchPrefix(v)
			if (key === 'ticketPrefix') return setTicketPrefix(v)
		}
		if (stepId === 'operator' && key === 'name') return setOperatorName(v)
		setConnector(stepId, { fields: { ...connectors[stepId]?.fields, [key]: v } })
	}

	const isDone = (stepId: string): boolean => {
		if (stepId === 'paths') return !!rootPath && !!wtPath
		if (stepId === 'tmux') return tmuxAvailable === true
		if (stepId === 'operator') return !!operatorName.trim()
		return !!connectors[stepId]?.connected
	}

	const connect = async (stepId: string) => {
		if (stepId === 'tmux') {
			await checkTmuxAvailable()
			if (!isDone('tmux')) return // stay open on failure so the user sees the error + install note
		} else if (stepId === 'operator') {
			// Setting.operatorName has its own long-standing API (/api/settings, server/settings.cjs-backed,
			// distinct from AppConfig) since it's read by orch.cjs/tasks.cjs's AI prompt text, not the generic
			// connector map.
			await syncOperatorName(fieldValue('operator', 'name').trim())
		} else if (stepId === 'sentry') {
			// Sentry has its own long-standing config API (server/settings.cjs-backed, distinct from
			// AppConfig) since sentry.cjs needs an Auth Token, not the DSN the generic connector map
			// would otherwise write — see SETUP_CONNECTOR_MAP's comment in index.cjs.
			const fields = { token: fieldValue('sentry', 'token'), org: fieldValue('sentry', 'org'), project: fieldValue('sentry', 'project') }
			try {
				const r = await setSentryConfig({ sentryToken: fields.token, sentryOrg: fields.org, sentryProject: fields.project })
				setConnector('sentry', { fields, connected: r.configured })
			} catch (e) {
				console.warn('[setup] sentry config failed:', e)
			}
		} else {
			const def = ALL.find((s) => s.id === stepId)!
			const fields = Object.fromEntries(def.fieldDefs.map((f) => [f.key, fieldValue(stepId, f.key)]))
			await syncConnector(stepId, fields)
		}
		const idx = ALL.findIndex((s) => s.id === stepId)
		const next = ALL.slice(idx + 1).find((s) => !isDone(s.id))
		setOpen(next ? next.id : null)
	}

	const doneCount = ALL.filter((s) => isDone(s.id)).length
	const reqDone = STEPS.filter((s) => isDone(s.id)).length
	const pct = Math.round((doneCount / ALL.length) * 100)
	const finishReady = reqDone >= STEPS.length

	const tmuxError = useSetupStore((s) => s.tmuxError)
	const tmuxVersion = useSetupStore((s) => s.tmuxVersion)

	const toVM = (def: StepDef): OnboardingStepVM => ({
		id: def.id,
		title: def.title,
		tag: def.tag,
		tagColorRgb: def.color,
		logo: def.logo,
		used: def.used,
		cta: def.cta,
		hint: def.id === 'tmux' && tmuxAvailable === false ? tmuxError || def.hint : def.id === 'tmux' && tmuxVersion ? tmuxVersion : def.hint,
		optional: def.req === 0,
		done: isDone(def.id),
		note: def.note,
		doneLabel: def.doneLabel,
		extra: def.id === 'github' ? <GithubConnectButtons /> : undefined,
		fields: def.fieldDefs.map((f) => ({
			label: f.label,
			placeholder: f.ph,
			value: fieldValue(def.id, f.key),
			onChange: (v: string) => setFieldValue(def.id, f.key, v),
			folderKind: f.folderKind,
		})),
	})

	return (
		<div className={`scroll-y ${styles.page}`} style={{ height: '100%' }}>
			<div className={styles.header}>
				<svg width="26" height="26" viewBox="0 0 24 24" fill="none">
					<path d="M12 3.2a8.8 8.8 0 1 0 6.3 2.5" stroke="var(--violet)" strokeWidth={2.6} strokeLinecap="round" />
					<circle cx="18.3" cy="5.7" r="2.7" fill="var(--blue)" />
				</svg>
				<div>
					<div className={styles.headerTitleRow}>
						<h1 className={styles.headerTitle}>OpenTask 초기 설정</h1>
						<span className={`m ${styles.localBadge}`}>로컬 저장</span>
					</div>
					<p className={styles.subtitle}>각 페이지가 필요로 하는 연결을 여기서 한 번에. 지금 건너뛰고 페이지에서 개별 연결도 가능합니다.</p>
				</div>
			</div>

			<div className={styles.progressCard}>
				<div className={styles.progressMain}>
					<div className={styles.progressTitleRow}>
						<span className={styles.progressTitle}>설정 진행률</span>
						<span className={`m ${styles.progressCount}`}>
							{doneCount} / {ALL.length}
						</span>
					</div>
					<div style={{ marginTop: 9 }}>
						<ProgressBar pct={pct} />
					</div>
				</div>
				<button className={`${styles.finishBtn} ${finishReady ? styles.finishBtnReady : ''}`}>{finishReady ? 'OpenTask 시작' : `필수 ${reqDone}/${STEPS.length}`}</button>
			</div>

			<div className={styles.sectionLabel}>
				<span className={styles.sectionDot} style={{ background: 'var(--violet)' }} />
				<span className={styles.sectionText}>필수 · 핵심 워크플로</span>
			</div>
			<div className={styles.stepList}>
				{STEPS.map((def) => (
					<OnboardingStep key={def.id} step={toVM(def)} open={open === def.id} onToggle={() => setOpen((o) => (o === def.id ? null : def.id))} onConnect={() => connect(def.id)} onSkip={() => setOpen(null)} />
				))}
			</div>

			<div className={styles.sectionLabel}>
				<span className={styles.sectionDot} style={{ background: 'var(--amber)' }} />
				<span className={styles.sectionText}>환경변수 · .env</span>
				<span className={styles.sectionNote}>런타임에 주입 · 로컬에만 저장</span>
			</div>
			<EnvVarTable />

			<div className={styles.sectionLabel} style={{ marginTop: 26 }}>
				<span className={styles.sectionDot} style={{ background: 'var(--t3)' }} />
				<span className={styles.sectionText}>선택 · 모니터 연동</span>
			</div>
			<div className={styles.stepList}>
				{OPTS.map((def) => (
					<OnboardingStep key={def.id} step={toVM(def)} open={open === def.id} onToggle={() => setOpen((o) => (o === def.id ? null : def.id))} onConnect={() => connect(def.id)} onSkip={() => setOpen(null)} />
				))}
			</div>
		</div>
	)
}
