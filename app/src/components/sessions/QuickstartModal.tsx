import Modal from '../common/Modal'
import { useT } from '../../utils/i18n'
import styles from './QuickstartModal.module.css'

// "퀵스타트 페이지는 처음 이 앱을 켰을 때 띄워주면 어때?" — 열림 상태는 useQuickstartStore가 관리하고
// (SessionsPage에서 자동 오픈, SettingsModal에서 재오픈), 이 컴포넌트는 순수 표시만 담당한다.
const STEPS = [
	{
		title: '태스크 만들기',
		body: '사이드바 검색창 위 "태스크 추가"를 누르면 메인 태스크 또는 서브태스크를 만들 수 있어요. Figma·슬랙·Notion·PR 링크를 그대로 붙여넣으면 종류가 자동으로 인식됩니다.',
	},
	{
		title: '서브태스크 = 워크트리',
		body: '서브태스크를 만드는 순간 격리된 git worktree와 실제 터미널 세션이 열립니다. 실제 코드 작업은 여기서만 일어나요.',
	},
	{
		title: '태스크 매니저가 자동으로 지휘',
		body: '별도 시작 버튼이 없습니다 — 서브태스크가 생기면 곧바로 순차 웨이브로 지휘를 시작하고, 라이브 터미널과 계획·지시·보고 로그를 함께 보여줍니다.',
	},
	{
		title: '하이브마인드에게 말해보세요',
		body: '사이드바 "하이브마인드"를 열면 버튼 없이 바로 대화가 시작돼요. "다음 주 화요일부터 목요일까지 QA 기간으로 막아줘"처럼 시켜보세요 — 태스크 하나가 아니라 캘린더·크론잡·설정까지 앱 전체를 자연어로 조작하는 최상위 에이전트입니다.',
	},
	{
		title: '캘린더 · 크론잡',
		body: '캘린더로 일정을 잡고 드래그로 재조정하세요. 크론잡으로 반복 업무를 예약하면 정해진 시각에 실제로 새 태스크가 만들어집니다.',
	},
]

export default function QuickstartModal({ open, onClose }: { open: boolean; onClose(): void }) {
	const t = useT()
	return (
		<Modal open={open} onClose={onClose} width={480}>
			<div className={styles.head}>
				<span>{t('OpenTask 퀵스타트')}</span>
				<span className={styles.close} onClick={onClose}>
					×
				</span>
			</div>
			<div className={styles.body}>
				<p className={styles.lede}>{t('태스크 아래 서브태스크를 만들면, AI가 워크트리에서 웨이브로 작업을 지휘합니다.')}</p>
				<ol className={styles.steps}>
					{STEPS.map((s, i) => (
						<li key={s.title} className={styles.step}>
							<span className={styles.marker}>{i + 1}</span>
							<div>
								<div className={styles.stepTitle}>{t(s.title)}</div>
								<div className={styles.stepBody}>{t(s.body)}</div>
							</div>
						</li>
					))}
				</ol>
				<div className={styles.footer}>
					<a className={styles.docsLink} href="https://opentask.jaehwankim.dev/docs" target="_blank" rel="noopener noreferrer">
						{t('더 자세한 사용법 →')}
					</a>
					<button type="button" className={styles.startBtn} onClick={onClose}>
						{t('시작하기')}
					</button>
				</div>
			</div>
		</Modal>
	)
}
