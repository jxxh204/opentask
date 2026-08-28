# OpenRM

> An AI dev control plane for [Claude Code](https://docs.anthropic.com/en/docs/claude-code): a **90 subagent + 55 skill** engine library, plus the **web app** that monitors and directs parallel AI agents across your git worktrees.

![license](https://img.shields.io/badge/license-MIT-blue) ![agents](https://img.shields.io/badge/agents-90-0d8079) ![skills](https://img.shields.io/badge/skills-55-9c6412)

This is a monorepo with two parts:

- **[`agents/`](./agents), [`skills/`](./skills)** — the engine. Drop-in subagents and slash-command skills for Claude Code (see below).
- **[`app/`](./app)** — the control plane, shipped as the desktop app **OpenTask**. A Vite+Node app that watches your tasks/subtasks/agents/PRs in real time and lets you dispatch work. Runs standalone with demo data, or connect a real repo for the full live experience. **→ [`app/README.en.md`](./app/README.en.md) for setup** (Korean: [`app/README.md`](./app/README.md)).

## What is the engine?

Claude Code gets dramatically more capable when it can hand work to **specialist subagents** and follow **repeatable skills**. `agents/` and `skills/` are a curated library of both — code reviewers, test generators, migration workflows, debugging playbooks, planning pipelines — extracted from a real team's production setup and **genericized** (every company/product/domain identifier replaced with a `${PLACEHOLDER}`).

Drop them into `~/.claude/` and Claude Code picks them up automatically. Ask it to review a PR, generate tests, or trace an impact — and it routes to the right specialist in an isolated context, keeping your main thread clean.

## What's inside

### 🤖 Agents (90) — specialist subagents, isolated context

| Group | Count | Examples |
|---|:---:|---|
| **General / AI-DLC** | 15 | `code-simplifier` · `debugger` · `spec-writer` · `tester` · `requirements-analyst` · `spec-compliance-reviewer` |
| **Backend** | 33 | `backend-code-reviewer` · `backend-db-investigator` · `backend-security-reviewer` · `backend-perf-checker` · `backend-tdd-guide` |
| **Web** (React / Next.js) | 4 | `web-design-analyzer` · `web-backlog-writer` · `web-policy-auditor` · `web-qa-reviewer` |
| **Android** (Compose) | 14 | `android-tc-generator` · `android-build-healer` · `android-review-healer` · `android-unit-test-runner` |
| **iOS** (SwiftUI / TCA) | 24 | `ios-build-checker` · `ios-feature-builder` · `ios-network-builder` · `ios-test-builder` · `ios-side-effect-analyzer` |

### 🧩 Skills (55) — repeatable `/slash` workflows

| Theme | Examples |
|---|---|
| **Testing** | `create-unit-test` · `create-e2e-test` · `create-integration-test` · `a11y-check` · `playwright-cli` · `hydration-debugger` |
| **Code review** | `review-pr` · `review-api` · `policy-auditor` · `qa-reviewer` · `figma-design-audit` |
| **Git & PR** | `create-commit` · `create-pr` · `commit-splitter` · `resolve-issue` · `shared-finishing-branch` · `shared-receiving-code-review` |
| **Scaffolding** | `create-common-component` · `create-domain-feature` · `folder-structure` · `type-conventions` · `resolve-icon` |
| **Migration** | `execute-domain-migration` · `verify-domain-migration` · `migration-workflow` · `report-migration-result` |
| **Backlog & planning** | `figma-to-backlog` · `backlog-writer` · `design-analyzer` · `impact-analysis` · `api-integration` |
| **Workflow orchestration** | `workflow` · `epic-workflow` · `backlog-execute` · `backlog-dashboard` · `figma-review-loop` (the `marty-*` suite) |
| **Debugging & meta** | `shared-systematic-debugging` · `shared-verification-before-completion` · `shared-spec-self-review` · `skill-creator` |

**Full list with one-line descriptions → [`MANIFEST.md`](./MANIFEST.md)**

## Install

```bash
git clone https://github.com/jxxh204/opentask
cd opentask
./install.sh          # copies agents → ~/.claude/agents, skills → ~/.claude/skills
```

Restart Claude Code, then confirm with `/agents` and `/skills`. For a single project instead of globally, copy into that repo's `.claude/agents` and `.claude/skills`.

## Configuration

Most agents/skills (review, testing, debugging, scaffolding) work with **zero config**.
A few that touch Notion, Slack, Figma, or a ticket prefix use `${PLACEHOLDER}` tokens — fill them in [`config.example.json`](./config.example.json) or just replace the `${...}` inline. The most common one is `${TICKET_PREFIX}` (your issue key, e.g. `JIRA`).

## Notes

- **Genericized origin.** Extracted from an internal setup; company/product/domain/personal identifiers were replaced with placeholders and the product-line prefixes (`b2b-`/`b2c-`) were removed with duplicates merged. Automated scans confirm **zero** residual identifiers.
- **Content language.** Agent/skill bodies are written in **Korean**. (Contributions translating them are welcome.)
- **Adapt-to-your-project files.** A handful reference a design system or a specific business domain — see [`REWRITE_NEEDED.md`](./REWRITE_NEEDED.md) to swap in your own.

## Contributing

Issues and PRs welcome — new generic agents/skills, translations, or genericizing the "adapt" files. Keep contributions free of company-specific identifiers (no internal hosts, IDs, or credentials).

## License

[MIT](./LICENSE). Individual items citing an external source (e.g. `karpathy-guidelines`) follow their original attribution.
