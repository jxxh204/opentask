import { useSessionsStore } from '../../store/useSessionsStore'
import { useT } from '../../utils/i18n'
import RepoRow from './RepoRow'
import styles from './RepoTable.module.css'

// 멀티레포 프로젝트용 "연결된 레포" 관리 — 0~1개면 오케스트레이션은 지금처럼 단일 rootPath로 동작.
// 2개 이상 등록하면 새 태스크가 제목/설명 기반으로 자동배정되고(task.repoClassify 프롬프트),
// TaskRow에서 언제든 드롭다운으로 override 가능.
export default function RepoTable({ onAddRepo }: { onAddRepo: () => void }) {
	const t = useT()
	const repos = useSessionsStore((s) => s.repos)
	const updateRepo = useSessionsStore((s) => s.updateRepo)
	const removeRepo = useSessionsStore((s) => s.removeRepo)

	return (
		<div className={styles.wrap}>
			<div className={styles.headRow}>
				<span className={styles.headCell}>이름</span>
				<span className={styles.headCell}>경로</span>
				<span className={styles.headCell}>기본 브랜치</span>
				<span className={styles.headCell}>설명 (자동배정 판단 근거)</span>
				<span className={styles.headCell}>{t('워크트리')}</span>
				<span />
			</div>
			{repos.map((repo) => (
				<RepoRow key={repo.id} repo={repo} onUpdate={(patch) => updateRepo(repo.id, patch)} onRemove={() => removeRepo(repo.id)} />
			))}
			{repos.length === 0 && <div className={styles.empty}>등록된 레포 없음 — 이 프로젝트가 단일 레포면 안 채워도 됩니다.</div>}
			<div className={styles.footer}>
				{/* "레포추가 버튼동작안해" — createRepo({..., path: ''})를 바로 호출했는데, 서버가 경로 없이는
				    당연히 거부한다(StoreRepos.create: "이름과 경로는 필수입니다."). 그 에러가 전역 store.error에만
				    쌓이고 이 화면 어디에도 렌더되는 자리가 없어서 클릭해도 아무 반응이 없어 보였다 — 이미
				    있던 AddRepoModal(경로 입력·클론 등 제대로 된 폼)을 열도록 바꾼다. */}
				<button className={styles.addBtn} onClick={onAddRepo}>
					+ 레포 추가
				</button>
				<div style={{ flex: 1 }} />
				{repos.length === 1 && <span className={`m ${styles.hintText}`}>1개뿐이면 자동배정 안 함 — 지금처럼 단일 레포로 동작</span>}
				<span className={`m ${styles.countText}`}>{repos.length}개 레포</span>
			</div>
		</div>
	)
}
