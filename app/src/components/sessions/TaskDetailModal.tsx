import TaskDetailContent from './TaskDetailContent'
import styles from './TaskDetailModal.module.css'

// "캘린더의 일감을 눌렀을 때 해당 일감의 내용이 나왔으면" — 전엔 칩을 누르면 바로 터미널 탭으로
// 점프했다(작업을 실제로 시작한 적 없는 미분류 일감도 마찬가지라 어색했다). Asana류 태스크 상세 참고
// UI로 요청받았으나, 담당자/하위작업/댓글처럼 이 앱에 없는 개념은 만들지 않고 실제로 있는 필드
// (제목/설명/마감일/레포/브랜치)만 그 톤으로 보여준다.
//
// "모달 말고 오른쪽에서 슬라이드인하는 사이드 메뉴로" 피드백으로 공용 Modal(중앙 오버레이) 대신
// DESIGN.md에 이미 문서화된 "드로어 플로트" 패턴(디버그 InspectorDrawer와 동일 — 오른쪽 고정,
// -16px 0 40px 그림자, transform translateX 트랜지션)을 그대로 따른다. Modal은 닫히면 즉시
// null을 반환해 언마운트되는데, 드로어는 슬라이드 아웃 되는 동안 계속 떠 있어야 해서 항상 마운트해
// 두고 transform으로만 여닫는다.
//
// 실제 필드/핸들러는 전부 TaskDetailContent(공용) — "메인 태스크 상세" 탭(TaskDetailTab)도 같은
// 컴포넌트를 감싸기만 다르게 해서 재사용한다. 이 파일은 오버레이+드로어 크롬만 담당.
export default function TaskDetailModal({ taskId, onClose }: { taskId: string | null; onClose(): void }) {
	const open = taskId !== null
	return (
		<div className={styles.overlay} style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }} onClick={onClose}>
			<div className={styles.drawer} style={{ transform: open ? 'translateX(0)' : 'translateX(100%)' }} onClick={(e) => e.stopPropagation()}>
				<TaskDetailContent taskId={taskId} onClose={onClose} />
			</div>
		</div>
	)
}
