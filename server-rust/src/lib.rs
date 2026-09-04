// lib.rs — HTTP 서버(bin/main.rs)와 MCP 서버(bin/mcp_control.rs) 등 여러 바이너리가 같은 비즈니스
// 로직(DB 스키마 + store 모듈)을 공유하기 위한 라이브러리 크레이트 루트. main.rs가 원래 `mod ...`로
// 직접 갖고 있던 걸 여기로 옮기고, main.rs는 `use opentask_server::*`로 재사용한다.
pub mod agent_jobs;
pub mod app_config;
pub mod blocked_periods;
pub mod branch_slug;
pub mod branches;
pub mod cockpit;
pub mod control;
pub mod cron_jobs;
pub mod db;
pub mod decisions;
pub mod env_vars;
pub mod folders;
pub mod github_connect;
pub mod holidays;
pub mod link_brief;
pub mod link_briefs;
pub mod notify;
pub mod orchestrator;
pub mod prompts;
pub mod prs;
pub mod repo_add;
pub mod repos;
pub mod reviews;
pub mod scheduler;
pub mod secrets;
pub mod settings;
pub mod setup;
pub mod subtask_sessions;
pub mod subtasks;
pub mod tasks;
pub mod term;
pub mod ticket;
pub mod transcript;
pub mod worktrees;
