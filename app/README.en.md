# OpenTask

🇺🇸 English (current) · 🇰🇷 [한국어](./README.md)

> A parallel dev control tower: add a subtask under a task and it gets an isolated git worktree plus an AI coding agent (Claude Code, etc.).

![license](https://img.shields.io/badge/license-MIT-blue)

This folder is the app (a Vite+Node full-stack) inside the [OpenRM](../README.md) monorepo — the
repository is still named OpenRM, but the app's product name is **OpenTask** (rebranded from the internal
codename "MRM" → "OpenRM" → "OpenTask," reflecting a task-centered identity based on what the top-level unit
of work should be). If [`agents/`](../agents) and [`skills/`](../skills) higher up in the same repo are the
engine for "what to do" (for Claude Code), this app is the control tower that shows and directs the current
state of your tasks, subtasks, and agents.

## What is this?

Create a subtask under a task and it gets its own isolated git worktree with a real tmux/Claude Code
terminal session — the Task Manager then drives your AI agents through sequential "waves." Schedule work on
the calendar, automate recurring chores with cron jobs, and act on PR review comments directly — Apply
(commits and pushes) or Dispute (a public reply on GitHub) — all without switching tabs.

For a full usage guide per screen, see the website Docs: https://opentask-website.vercel.app/en/docs.html

## Install & Run (works out of the box, no config needed)

```bash
git clone https://github.com/jxxh204/opentask
cd opentask/app
npm install
npm run start   # backend (8770) + frontend (5180) together, color-coded logs. Ctrl+C stops both
```

To launch it straight as a desktop window (Electron):

```bash
npm run electron:dev
```

Run it with no configuration and you get **demo data** so you can explore the whole screen layout (task
tree · calendar · cron jobs · control) right away. To connect your real repo, hit "Add Repo" on the
onboarding screen.

## Structure

```
openrm/
├── agents/, skills/      # the engine (for Claude Code, see the root README)
└── app/                  # ← you are here
    ├── server/           # backend (Node) — manages task/folder/subtask/calendar/cron-job state
    ├── electron/         # macOS desktop shell (main.cjs) — runs the backend as a detached process
    ├── src/              # frontend (React CSR, Vite + TS)
    ├── vite.config.ts    # proxies 5180 → backend 8770
    └── config.example.sh # every configuration option (optional)
```

## What's inside (the real tab layout)

Following the "every menu comes from a tab" rule, there are no separate pages or routes — opening a task or
subtask opens the tabs below inside the workspace.

| Tab | What it does |
|---|---|
| Task Manager | The AI conductor that starts automatically once a subtask exists — runs sequential waves + a live terminal + plan/dispatch/report log |
| Diagram | A board summarizing the subtask chain like an assembly line — status (waiting/in progress/done) and scheduled duration |
| Calendar | Week/month layout of subtask schedules, drag-to-reschedule, blocked periods (e.g. a QA freeze) |
| Cron Jobs | Interval / daily / weekly schedules — deliberately limited to the single action "create a new task" |
| Model Policy | Per-task-type (design, Task Manager, coding, review, QA, etc.) AI model policy |
| Team Rules | Four free-text fields per repo (general rules / task-writing rules / branch rules / pre-dev prerequisites) folded into agent instructions |
| Control | A top-level agent that runs the whole app (calendar · cron jobs · settings) by conversation, not a single task |
| Terminal · Local Server · Browser · Claude Session | The real dev environment for a subtask's worktree — tmux terminal, dev server, embedded browser, standalone Claude Code session |
| PR Review | "Apply" a review comment (injects into a live session, through commit and push) or "Dispute" it (a public reply on GitHub) |

See [`config.example.sh`](./config.example.sh) for every setting — most are optional, and most of the
features above work with nothing filled in.

## What's missing from the original

A handful of features tightly coupled to internal company infrastructure (AWS MFA, remote login, GTM, PPT,
private internal tools) were left out of this core release. See [`ADAPT.md`](./ADAPT.md) for details and for
what still needs to be swapped to your own identity (leftover personalization from the original author).

## Security

Designed for local execution, but since this server can run git/shell/terminal commands directly, it binds
to `127.0.0.1` (loopback) by default. Setting `OPENRM_HOST=0.0.0.0` to open it on the LAN automatically
requires token auth (printed to the console). Even so, don't expose it on an untrusted network.

## License

[MIT](../LICENSE) — shared with the repo root.
