import { useSessionsStore } from '../../store/useSessionsStore'
import { useTabsStore } from '../../store/useTabsStore'
import { useT } from '../../utils/i18n'
import TaskDetailContent from './TaskDetailContent'
import styles from './TaskDetailModal.module.css'

// "메인태스크 상세 탭이 여전히없어" — 다이어그램(TaskManagerBoard)은 서브태스크 체인을 시각화하는
// 별도 탭이고, 이건 그거와 다르다: TaskDetailModal(드로어)이 보여주던 실제 필드(제목/완료/마감일·
// 기간/서브태스크/레포/설명)를 오버레이 없이 탭 본문에 그대로 채운 것. 폴더 하나엔 보통 태스크가
// 하나뿐이다(FolderCard.tsx의 onlyTask 관례와 동일) — 그 첫 태스크를 "이 메인 태스크"로 삼는다.
export default function TaskDetailTab({ nodeId, tabId, folderId }: { nodeId: string; tabId: string; folderId: string }) {
	const t = useT()
	const closeTab = useTabsStore((s) => s.closeTab)
	const taskId = useSessionsStore((s) => s.folders.find((f) => f.id === folderId)?.tasks[0]?.id ?? null)

	if (!taskId) {
		return (
			<div className={styles.tabWrap}>
				<div className={styles.tabWrapInner}>
					<div className={styles.body}>{t('이 메인 태스크가 아직 비어 있습니다.')}</div>
				</div>
			</div>
		)
	}

	return (
		<div className={styles.tabWrap}>
			<div className={styles.tabWrapInner}>
				<TaskDetailContent taskId={taskId} onClose={() => closeTab(nodeId, tabId)} showPinToTab={false} />
			</div>
		</div>
	)
}
