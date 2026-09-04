// prompts.rs — app/server/prompts.cjs 이식. 원본은 리뷰·추정·코드브리핑 등 수십 개 템플릿을 담은
// 395줄짜리 레지스트리+사용자 오버라이드 편집기(설정 화면의 "프롬프트 커스터마이즈")다. 이번 패스는
// link_brief.rs가 실제로 쓰는 link.brief.notion/link.brief.figma 두 개만 포팅한다 — render()의
// {토큰} 치환 로직과 오버라이드 파일(OPENRM_PROMPTS_FILE) 우선순위는 원본과 동일하게 유지해, 사용자가
// 이 두 프롬프트를 커스터마이즈해뒀다면 그대로 존중한다. 나머지 템플릿·list()/setOverride() 편집기
// API는 미포팅(§ 알려진 축소 — 프롬프트 커스터마이즈 화면은 이 두 키에 한해서만 아직 동작 안 함).
use serde_json::Value;
use std::collections::HashMap;

fn registry_template(key: &str) -> Option<&'static str> {
	match key {
		"link.brief.notion" => Some(
			"너는 이 태스크에 첨부된 노션 문서를 읽고, 개발자가 문서를 직접 열어보지 않고도 바로 개발에 착수할 수 있을 만큼 핵심만 뽑는 브리핑 작성자다.\n\
Notion MCP(notion-fetch)로 아래 URL의 페이지 본문과 하위 블록을 실제로 읽어라. 접근 실패(MCP 미가동·권한 없음)면 그 사실을 summary에 명시하고 policies는 빈 배열로 남겨라 — URL 슬러그만 보고 절대 지어내지 마라(실제로 읽었을 때만 policies를 채워라).\n\
summary는 이 문서가 다루는 것과 왜 중요한지 2~4문장.\n\
policies에는 개발자가 놓치면 실수하는 구체적 정책·조건·엣지케이스를 최대 6개, 각각 한 문장으로 짧고 확실하게(모호한 표현·일반론 금지, 문서에 실제로 적힌 내용 그대로).\n\
설명·코드블록 없이 아래 JSON 객체 \"하나만\" 출력해:\n\
{\"summary\":\"2~4문장\",\"policies\":[\"구체적 정책 한 줄\",...]}\n\
\n\
문서: {url}",
		),
		"link.brief.figma" => Some(
			"너는 이 태스크에 첨부된 피그마 디자인을 읽고 핵심만 뽑는 브리핑 작성자다.\n\
Figma MCP(get_design_context·get_metadata)로 아래 URL이 가리키는 프레임/노드를 실제로 확인해라. 접근 실패면 그 사실을 summary에 명시하고 policies는 빈 배열로 남겨라 — 링크 이름만 보고 지어내지 마라.\n\
summary는 이 화면이 무엇을 보여주는지와 핵심 목적 2~4문장.\n\
policies에는 개발자가 그대로 구현에 반영해야 할 구체적 사항(문구 강조·공용 컴포넌트 재사용 여부·상태별 분기·배치 규칙 등)을 최대 6개, 각각 한 문장으로.\n\
설명·코드블록 없이 아래 JSON 객체 \"하나만\" 출력해:\n\
{\"summary\":\"2~4문장\",\"policies\":[\"구체적 정책 한 줄\",...]}\n\
\n\
디자인: {url}",
		),
		_ => None,
	}
}

fn overrides_file() -> std::path::PathBuf {
	std::env::var("OPENRM_PROMPTS_FILE").map(std::path::PathBuf::from).unwrap_or_else(|_| std::path::PathBuf::from(".openrm-prompts.json"))
}

fn template_for(key: &str) -> String {
	if let Ok(raw) = std::fs::read_to_string(overrides_file()) {
		if let Ok(overrides) = serde_json::from_str::<Value>(&raw) {
			if let Some(t) = overrides.get(key).and_then(Value::as_str) {
				return t.to_string();
			}
		}
	}
	registry_template(key).unwrap_or_default().to_string()
}

/// render — {토큰} 치환. 등록 안 된 키/빈 템플릿은 빈 문자열.
pub fn render(key: &str, vars: &HashMap<&str, String>) -> String {
	let mut t = template_for(key);
	if t.is_empty() {
		return t;
	}
	for (k, v) in vars {
		t = t.replace(&format!("{{{k}}}"), v);
	}
	t
}
