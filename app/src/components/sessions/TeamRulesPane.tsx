import { useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '../../store/useSessionsStore'
import { useTabsStore, CONTROL_NODE_ID } from '../../store/useTabsStore'
import { askControl } from '../../api/control'
import type { Repo, Folder } from '../../store/types'
import RepoSelect from './RepoSelect'
import styles from './TeamRulesPane.module.css'

// "브랜치 이름은 영문에 프리픽스가 있고, 브랜치를 만들기 전에 노션 문서를 써야 해... 이건 내가
// 명시하지 못한 문제가 있으니... 오픈소스로 풀 앱이라서 외부에서 이런 설정을 할 수 있어야해" —
// 팀마다 다른 개발 관행을 코드에 박지 않고, 레포당 자유 텍스트 4칸으로 받는다. OpenTask 코드는 이
// 텍스트의 내용을 파싱하지 않는다 — 그대로 conductorSeed/launchSubtask의 에이전트 지시문에 얹히고,
// 실제로 규칙을 "수행"하는 건 그 지시문을 읽는 에이전트다(브랜치 리네임, 노션 문서 작성 등 이미 가진
// shell/MCP 툴로). 네 칸을 전부 비워두면 지금과 완전히 동일하게 동작한다.
const RULE_SLOTS: { key: 'rule_general' | 'rule_task_writing' | 'rule_branch' | 'rule_predev'; patchKey: 'ruleGeneral' | 'ruleTaskWriting' | 'ruleBranch' | 'rulePredev'; icon: string; title: string; where: string; hint: string; placeholder: string; askFor: string }[] = [
	{
		key: 'rule_general',
		patchKey: 'ruleGeneral',
		icon: '🌐',
		title: '일반 규칙',
		where: '모든 지점 · 항상 동반',
		hint: '아래 세 칸 중 어디에도 안 맞는 것 — 커밋 메시지 포맷, PR 템플릿 등. 모든 에이전트 지시문에 항상 함께 실린다.',
		placeholder: '예: 커밋 메시지는 한국어 한 줄 요약 + Conventional Commits 접두사(feat/fix/chore)를 붙인다.',
		askFor: '커밋 메시지 포맷, PR 템플릿, 코드 스타일처럼 모든 작업에 공통으로 적용할 규칙',
	},
	{
		key: 'rule_task_writing',
		patchKey: 'ruleTaskWriting',
		icon: '📝',
		title: '태스크 작성 규칙',
		where: '적용: 일감 검토 · 서브태스크 생성',
		hint: '서브태스크를 쓰거나 다듬을 때 태스크 매니저가 참고할 문체·필수 항목.',
		placeholder: '예: 서브태스크 설명엔 항상 완료 기준(Acceptance Criteria)을 포함한다.',
		askFor: '태스크/서브태스크를 작성할 때 반드시 포함해야 할 항목이나 문체',
	},
	{
		key: 'rule_branch',
		patchKey: 'ruleBranch',
		icon: '🌿',
		title: '워크트리 · 브랜치 생성 규칙',
		where: '적용: 서브태스크 워크트리 생성',
		hint: '채우면 브랜치명이 자동으로 영문 슬러그로 번역되고, 이 규칙 원문이 그 서브태스크 세션에 전달돼 필요하면 직접 git branch -m으로 다듬는다.',
		placeholder: '예: 브랜치명은 영문 kebab-case. 항상 GBIZ- 접두사를 붙인다.',
		askFor: '브랜치 네이밍 컨벤션(접두사, 티켓 번호 출처, 소문자/대문자 규칙 등)',
	},
	{
		key: 'rule_predev',
		patchKey: 'rulePredev',
		icon: '🚦',
		title: '개발 시작 전 필수 조건',
		where: '적용: 서브태스크 개발 시작',
		hint: '이 조건이 있으면 서브태스크 세션이 코드를 작성하기 전에 먼저 처리하도록 지시받는다(예: 노션 문서 작성).',
		placeholder: '예: 브랜치를 만들기 전에 노션에 스펙 문서를 먼저 쓰고, 그 링크를 서브태스크 설명에 채워 넣는다.',
		askFor: '코드를 작성하기 전에 반드시 끝내둬야 할 사전 절차(문서 작성 도구·형식 포함)',
	},
]

// "이것도 저장이 되게해줘" — 전역 팀 규칙 탭(폴더 맥락 없이 열렸을 때)의 레포 선택도 순수 로컬
// state라 탭을 닫았다 다시 열면(또는 앱 재시작하면) 항상 첫 번째 레포로 돌아갔다. §repoFilters와
// 같은 localStorage 관례. 폴더 탭의 "+"로 열렸을 땐(initialRepoId 있음) 그 폴더의 레포로 스코프하는
// 게 항상 우선이라 여기 저장값을 초기값으로 쓰지 않는다 — 아래 useState 초기화에서 분기.
const LAST_REPO_KEY = 'openrm.teamRules.lastRepoId'

function loadLastRepoId(): string | null {
	try {
		return localStorage.getItem(LAST_REPO_KEY)
	} catch {
		return null
	}
}

function saveLastRepoId(id: string) {
	try {
		localStorage.setItem(LAST_REPO_KEY, id)
	} catch {
		/* private mode / no storage — fine, just won't persist */
	}
}

type Draft = { rule_general: string; rule_task_writing: string; rule_branch: string; rule_predev: string; rule_task: string }

function sourceOf(repo: Repo | null, folder: Folder | undefined): Draft {
	return {
		rule_general: repo?.rule_general ?? '',
		rule_task_writing: repo?.rule_task_writing ?? '',
		rule_branch: repo?.rule_branch ?? '',
		rule_predev: repo?.rule_predev ?? '',
		rule_task: folder?.rule_task ?? '',
	}
}

// initialRepoId — 폴더 탭의 "+"로 열렸을 때(§ TabWorkspace) 그 폴더가 실제 쓰는 레포로 미리
// 스코프한다. 설정 모달을 거쳐 전역 탭(TEAM_RULES_NODE_ID)으로 열렸을 땐 undefined — 첫 레포로 폴백.
// folderId — 있을 때만(=폴더 탭의 "+"로 열렸을 때) "이 태스크만의 규칙" 칸을 보여준다. 전역 탭엔
// "지금 이 태스크"라는 맥락 자체가 없어서 이 칸은 애초에 뜨지 않는다.
export default function TeamRulesPane({ initialRepoId, folderId }: { initialRepoId?: string | null; folderId?: string } = {}) {
	const repos = useSessionsStore((s) => s.repos)
	const reposLoaded = useSessionsStore((s) => s.reposLoaded)
	const updateRepo = useSessionsStore((s) => s.updateRepo)
	const setFolderTaskRule = useSessionsStore((s) => s.setFolderTaskRule)
	const folder = useSessionsStore((s) => (folderId ? s.folders.find((f) => f.id === folderId) : undefined))
	// "저장버튼으로 저장되게 해줘. 처음 팀규칙을 킬때 저장된걸로 켜지게해줘" — 전엔 레포를 고르는
	// 즉시 localStorage에 반영돼서(§ "기억됨" 토스트) 그냥 훑어보기만 해도 다음 기본값이 계속
	// 바뀌었다. savedRepoId(마지막으로 실제 저장 버튼을 눌러 확정한 값)와 repoId(지금 화면에 고른
	// 값, 아직 미확정일 수 있음)를 분리 — 전역 탭의 기본값은 savedRepoId를 따르고, 저장 버튼을
	// 눌러야만 그 확정값이 바뀐다. 폴더 탭("+"로 연 것)은 원래부터 이 기억과 무관하게 항상 그
	// 폴더 고유 레포(initialRepoId)로 스코프되므로 그대로 둔다.
	const [savedRepoId, setSavedRepoId] = useState<string | null>(() => loadLastRepoId())
	const [repoId, setRepoId] = useState<string | null>(null)
	const defaultRepoId = (folderId ? initialRepoId : savedRepoId && repos.some((r) => r.id === savedRepoId) ? savedRepoId : initialRepoId) ?? repos[0]?.id ?? null
	// repoId가 가리키는 레포가 삭제됐으면(repos엔 없음) 조용히 빈 화면이 되는 대신 기본값으로 폴백한다.
	const activeRepoId = repoId && repos.some((r) => r.id === repoId) ? repoId : defaultRepoId
	const repo = repos.find((r) => r.id === activeRepoId) ?? null
	// 폴더 탭에서의 레포 전환은 저장 대상이 아니다(그 폴더의 고유 레포 배정과 무관한 일시적 열람) —
	// 전역 탭에서 고른 것만 "저장" 대상.
	const repoDirty = !folderId && repoId !== null && repoId !== savedRepoId

	function handleRepoChange(id: string | null) {
		if (!id) return
		setRepoId(id)
	}

	// "저장하기 버튼이 있어야할듯" — 전엔 textarea가 blur될 때마다 조용히 자동저장돼서 "저장됐다"는
	// 확신이 없었다. 이제 draft는 로컬 state로만 갖고 있다가 버튼을 눌러야 커밋된다. 다만 무작정
	// uncontrolled → controlled로만 바꾸면 "비서에게 물어보기"로 다른 경로(curl)를 통해 채워진 값이나
	// 다른 탭에서 바꾼 값이 이 패널엔 영영 안 보이게 된다 — 그래서 소스(repo/folder)가 바뀔 때마다
	// "사용자가 아직 손대지 않은 칸"만 최신값으로 동기화하고, 이미 편집 중인 칸은 저장 전까지 건드리지
	// 않는다(마지막으로 동기화한 소스값과 비교해 "아직 안 건드림"을 판정).
	const [draft, setDraft] = useState<Draft>(() => sourceOf(repo, folder))
	const lastSourceRef = useRef<Draft>(sourceOf(repo, folder))
	const lastRepoIdRef = useRef<string | null>(repo?.id ?? null)

	useEffect(() => {
		const nextSource = sourceOf(repo, folder)
		const prevSource = lastSourceRef.current
		const switched = (repo?.id ?? null) !== lastRepoIdRef.current
		setDraft((d) => {
			if (switched) return nextSource
			const merged = { ...d }
			;(Object.keys(nextSource) as (keyof Draft)[]).forEach((k) => {
				if (d[k] === prevSource[k]) merged[k] = nextSource[k]
			})
			return merged
		})
		lastSourceRef.current = nextSource
		lastRepoIdRef.current = repo?.id ?? null
	}, [repo, folder])

	const dirty = repoDirty || RULE_SLOTS.some((slot) => draft[slot.key] !== (repo?.[slot.key] ?? '')) || (!!folder && draft.rule_task !== (folder.rule_task ?? ''))
	const [saving, setSaving] = useState(false)

	async function handleSave() {
		if (!dirty || saving) return
		setSaving(true)
		try {
			const jobs: Promise<unknown>[] = []
			if (repoDirty && repoId) {
				saveLastRepoId(repoId)
				setSavedRepoId(repoId)
			}
			// 서버는 저장할 때 trim한 값을 저장한다(store/repos.cjs, folders.cjs) — draft는 사용자가
			// 타이핑한 원문(trim 전)을 그대로 들고 있으므로, 앞뒤 공백만 있던 경우 저장 후에도
			// draft !== repo[key]가 계속 참이 돼 "저장" 버튼이 안 꺼지는 문제가 있었다. 실제로 보낸
			// (trim된) 값으로 draft를 맞춰준다.
			const normalized: Draft = { ...draft }
			if (repo) {
				const patch: Partial<Record<(typeof RULE_SLOTS)[number]['patchKey'], string | null>> = {}
				for (const slot of RULE_SLOTS) {
					if (draft[slot.key] !== (repo[slot.key] ?? '')) {
						const trimmed = draft[slot.key].trim()
						patch[slot.patchKey] = trimmed || null
						normalized[slot.key] = trimmed
					}
				}
				if (Object.keys(patch).length > 0) jobs.push(updateRepo(repo.id, patch))
			}
			if (folder && draft.rule_task !== (folder.rule_task ?? '')) {
				const trimmed = draft.rule_task.trim()
				jobs.push(setFolderTaskRule(folder.id, trimmed || null))
				normalized.rule_task = trimmed
			}
			await Promise.all(jobs)
			setDraft(normalized)
		} finally {
			setSaving(false)
		}
	}

	const [asking, setAsking] = useState<string | null>(null)
	// "이게 그냥 작성하기는 어려운데... 관제에 질문하는 버튼 있으면 어떨까" — 빈칸에 자연어를 바로
	// 적기 어려우니, 관제에게 어느 레포·어느 규칙칸인지 맥락을 실어 보내 사람에게 되물어가며 대신
	// 채우게 한다. 완성된 문장을 사람이 다시 복붙할 필요 없도록, 그 값을 저장할 정확한 curl까지
	// 프롬프트에 박아준다(관제 seed의 기존 "MCP 실패 시 curl 폴백" 관례 그대로).
	async function askAbout(slot: (typeof RULE_SLOTS)[number]) {
		if (!repo || asking) return
		setAsking(slot.key)
		try {
			const port = window.location.port || '18771'
			const prompt = `"${repo.name}" 레포의 "${slot.title}"을(를) 정하려고 해. ${slot.askFor}에 대해 나한테 하나씩 물어봐서 답을 받고, 답변이 다 모이면 그걸 자연스러운 한국어 규칙 문장으로 정리해서 나한테 먼저 보여주고 확정받아. 확정되면 이 curl로 저장해: curl -s -X PATCH http://localhost:${port}/api/repos/${repo.id} -H 'Content-Type: application/json' -d '{"${slot.patchKey}":"<확정된 규칙 텍스트>"}'`
			await askControl(prompt)
			const s = useTabsStore.getState()
			if (!s.tabsByNode[CONTROL_NODE_ID]?.length) s.openTab(CONTROL_NODE_ID, 'control')
			s.setActiveNode(CONTROL_NODE_ID, 'control')
		} finally {
			setAsking(null)
		}
	}

	async function askAboutTask() {
		if (!folder || asking) return
		setAsking('task')
		try {
			const port = window.location.port || '18771'
			const prompt = `"${folder.name}" 태스크만의 특별 규칙(같은 레포의 다른 태스크엔 안 쓰이는 이 태스크만의 예외/특이사항)을 정하려고 해. 뭐가 있는지 나한테 하나씩 물어봐서 답을 받고, 답변이 다 모이면 자연스러운 한국어 문장으로 정리해서 먼저 보여주고 확정받아. 확정되면 이 curl로 저장해: curl -s -X PATCH http://localhost:${port}/api/folders/${folder.id} -H 'Content-Type: application/json' -d '{"ruleTask":"<확정된 규칙 텍스트>"}'`
			await askControl(prompt)
			const s = useTabsStore.getState()
			if (!s.tabsByNode[CONTROL_NODE_ID]?.length) s.openTab(CONTROL_NODE_ID, 'control')
			s.setActiveNode(CONTROL_NODE_ID, 'control')
		} finally {
			setAsking(null)
		}
	}

	return (
		<div className={styles.wrap}>
			<div className={styles.titleRow}>
				<div className={styles.title}>팀 규칙</div>
				<button type="button" className={styles.saveBtn} disabled={!dirty || saving} onClick={handleSave}>
					{saving ? '저장 중…' : '저장'}
				</button>
			</div>
			<div className={styles.hint}>브랜치 네이밍, 사전 문서 작성 같은 팀마다 다른 개발 관행을 자연어로 적어둔다. 레포별로 따로 저장되고, 네 칸을 전부 비워두면 지금과 완전히 동일하게 동작한다.</div>

			{/* "이건 태스크의 유니크한 규칙이야" — 아래 레포 공통 규칙과 달리 지금 이 메인 태스크
			    하나에만 적용된다(같은 레포의 다른 태스크는 영향 없음). 폴더 맥락 없이(설정 모달 경유)
			    열렸을 땐 "지금 태스크"가 없어 이 칸 자체를 안 보여준다. */}
			{folder && (
				<div className={`${styles.slot} ${styles.taskSlot}`}>
					<div className={styles.slotHead}>
						<span className={styles.slotIcon}>🎯</span>
						<span className={styles.slotTitle}>이 태스크만의 규칙 — "{folder.name}"</span>
						<button type="button" className={styles.askBtn} disabled={asking === 'task'} onClick={askAboutTask} title="비서에게 물어보면서 채우기">
							{asking === 'task' ? '비서 여는 중…' : '✦ 비서에게 물어보기'}
						</button>
					</div>
					<p className={styles.slotHint}>같은 레포의 다른 태스크에는 안 쓰이는, 이 태스크만의 예외·특이사항. 아래 팀 규칙보다 먼저 적용된다.</p>
					<textarea
						className={styles.slotInput}
						value={draft.rule_task}
						placeholder="예: 이 작업은 A/B 테스트 플래그로 감싸서 배포한다."
						onChange={(e) => setDraft((d) => ({ ...d, rule_task: e.target.value }))}
					/>
				</div>
			)}

			{!reposLoaded && <div className={styles.hint}>불러오는 중…</div>}
			{reposLoaded && repos.length === 0 && <div className={styles.hint}>연결된 레포가 없습니다 — 사이드바에서 레포를 먼저 추가하세요.</div>}

			{repo && (
				<>
					<div className={styles.repoSelectRow}>
						<RepoSelect repos={repos} valueId={repo.id} onChange={handleRepoChange} allowNone={false} />
						{repoDirty && <span className={styles.repoSelectPending}>저장 필요</span>}
					</div>

					<div className={styles.slots}>
						{RULE_SLOTS.map((slot) => (
							<div key={slot.key} className={styles.slot}>
								<div className={styles.slotHead}>
									<span className={styles.slotIcon}>{slot.icon}</span>
									<span className={styles.slotTitle}>{slot.title}</span>
									<span className={styles.slotWhere}>{slot.where}</span>
									<button type="button" className={styles.askBtn} disabled={asking === slot.key} onClick={() => askAbout(slot)} title="비서에게 물어보면서 채우기">
										{asking === slot.key ? '비서 여는 중…' : '✦ 비서에게 물어보기'}
									</button>
								</div>
								<p className={styles.slotHint}>{slot.hint}</p>
								<textarea
									className={styles.slotInput}
									value={draft[slot.key]}
									placeholder={slot.placeholder}
									onChange={(e) => setDraft((d) => ({ ...d, [slot.key]: e.target.value }))}
								/>
							</div>
						))}
					</div>
				</>
			)}
		</div>
	)
}
