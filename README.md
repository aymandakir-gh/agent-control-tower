# agent-control-tower

**One screen for your whole fleet of AI coding agents.** A local-first cockpit that reads
what Claude Code already writes to disk and shows you — live — which agents are working,
which are waiting on you, which errored, what each is doing right now, and how much it's all
costing. No more flying blind across ten terminal tabs.

[![CI](https://github.com/aymandakir-gh/agent-control-tower/actions/workflows/ci.yml/badge.svg)](https://github.com/aymandakir-gh/agent-control-tower/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520-43853d)
![Privacy](https://img.shields.io/badge/privacy-local--only%20%C2%B7%20read--only-3fb950)

```text
agent-control-tower  5 agents  (sample data)
▶ 2 working   ⏸ 1 waiting   ✖ 1 error   · 1 idle

STATUS   PROJECT          BRANCH         MODEL              TOOL             TURN      TOKENS   COST      LAST
▶ working infra            chore/upgrade  claude-opus-4-8    Agent            18s       66.8k    $0.4537   13s ago
▶ working api-server       feat/payments  claude-opus-4-8    Bash             18s       94.7k    $0.9653   18s ago
⏸ waiting web-app          main           claude-sonnet-4-6  AskUserQuestion  10s       20.3k    $0.0423   5s ago
✖ error  data-pipeline    fix/etl        claude-opus-4-8    Bash             18s       52.7k    $0.5475   11s ago
· idle   marketing-site   main           claude-haiku-4-5   —                42s       7.2k     $0.0059   15m ago

Fleet total: 241.6k tokens  $2.01
```

> Replace this block with an animated demo — see [Recording a demo](#recording-a-demo).

---

## Try it in 10 seconds

```bash
# No install — see a demo fleet immediately:
npx agent-control-tower scan --sample

# Watch your real agents live in the terminal:
npx agent-control-tower

# Or open the local web dashboard:
npx agent-control-tower web        # → http://127.0.0.1:4517
```

Nothing to configure. It finds your Claude Code sessions automatically and is **read-only** —
it never writes, moves, or deletes anything under `~/.claude`.

## Why this exists

As people run more **parallel** AI coding agents, the bottleneck shifts from *writing code*
to *supervising agents*. Today that means alt-tabbing between terminals and losing track of
who needs you and who's burning money. There's no good **open, local-first cockpit** for it —
commercial dashboards are cloud, closed, and want your data.

agent-control-tower is the missing cockpit: it reads the transcripts Claude Code already
writes and turns them into one live board. Private by construction, useful in seconds.

## What you get

- **Live status per agent** — `working` · `waiting` (needs you) · `error` · `idle`, derived
  by a documented [state machine](PRD.md#6-agent-state-machine-the-core-spec), not guesswork.
- **What & how long** — the current tool (Bash, Edit, a spawned sub‑agent…) and the live
  duration of the current turn.
- **Tokens & cost** — per‑agent and fleet‑wide estimates, including sub‑agent spend, with a
  configurable pricing table (clearly labelled as an estimate).
- **A unified timeline** — every agent's notable events merged into one time‑sorted stream.
- **Two faces, one brain** — a terminal UI (Ink) and a local web dashboard render the *same*
  core. The web server exposes a small JSON API.
- **Delightful empty state** — zero agents? `--sample` loads a bundled demo fleet.

## How it works

```
~/.claude/projects/**/<session>.jsonl   ──▶  src/sources (read-only I/O)
                                              │  discover · read · watch
                                              ▼
                                         src/core (pure, zero-I/O)
                                         parser → FSM → cost → timeline → fleet
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                                ▼
                        Ink TUI (src/tui)             Web dashboard (src/web)
                                                      Fastify JSON API + page
```

`src/core` is a pure library with **no filesystem and no network** — it turns transcript
*strings* into agent state, so it's exhaustively unit-tested. `src/sources` is the only code
that touches disk, and only ever reads.

## Commands

```
agent-control-tower [command] [options]

  tui            Live terminal board of all agents (default)
  scan           Print a one-shot snapshot and exit (great for pipes/cron)
  web            Serve the local web dashboard (127.0.0.1 only)
  help | version

Options:
  --sample       Use the bundled sample fleet (no real data needed)
  --root <dir>   Transcript root (default: ~/.claude/projects)
  --json         (scan) Emit JSON instead of a table
  --idle-ms <n>  Idle threshold in ms (default: 120000)
  --port <n>     (web) Port to serve on (default: 4517)
  --no-color     Disable ANSI colors
```

In the TUI: `↑/↓` select · `enter` detail · `s` cycle sort · `r` refresh · `p` pause ·
`k`/`f` kill/focus (stubbed) · `q` quit.

## HTTP API

The web server exposes a small read-only JSON API on `127.0.0.1`:

| Endpoint | Description |
|---|---|
| `GET /api/health` | version, root, sample flag, session/agent counts |
| `GET /api/fleet` | fleet totals + every agent snapshot |
| `GET /api/timeline?limit=N` | merged cross-agent timeline (most recent `N`) |
| `GET /api/agents/:id` | a single agent snapshot by session id (404 if unknown) |

## Privacy

**Local-first. Read-only. No telemetry. No accounts. No outbound network calls.** Ever.

- It only ever *reads* `~/.claude` — it never writes, mutates, or deletes your agent data.
- The web server binds to `127.0.0.1` and is never exposed on the network.
- Nothing leaves your machine. You can verify all of this from the source — the only
  filesystem code lives in `src/sources` and uses read-only calls.

## Recording a demo

The repo ships a [vhs](https://github.com/charmbracelet/vhs) tape so anyone can regenerate the
demo GIF deterministically:

```bash
# install vhs (https://github.com/charmbracelet/vhs), then:
vhs demo/demo.tape          # writes demo/demo.gif
```

Prefer [asciinema](https://asciinema.org)? `asciinema rec` while running
`agent-control-tower --sample` works too. See [demo/README.md](demo/README.md).

## Develop

```bash
pnpm install
pnpm test            # 100+ unit/integration tests
pnpm test:cov        # coverage (≥90% lines on src/core)
pnpm typecheck && pnpm lint
pnpm build           # → dist/
node dist/cli.js scan --sample
```

See [CONTRIBUTING.md](CONTRIBUTING.md). The project is **spec-driven**: every feature begins
as an acceptance criterion in [PRD.md](PRD.md) and ships with a test that proves it.

## Roadmap

- [x] M1 — pure core (parser · FSM · cost · timeline)
- [x] M2 — live Ink TUI board
- [x] M3 — web dashboard + JSON API
- [x] M4 — launch polish (this)
- [ ] Real `kill` / `focus` actions (opt-in, gated)
- [ ] More sources (hook events; other agent frameworks)
- [ ] Per-project grouping, filtering, and alerts ("ping me when an agent needs input")
- [ ] Historical cost trends

## License

MIT — see [LICENSE](LICENSE). Built in the open. PRs welcome.
