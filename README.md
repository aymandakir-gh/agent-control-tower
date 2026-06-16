# agent-control-tower

**One screen for your whole fleet of AI coding agents.** A local-first **control tower** that
reads what Claude Code (and other agents) already write to disk and shows you — live — which
agents are working, which are **waiting on you**, which **errored**, what each is doing right
now, and how much it's all costing. Then lets you **act**: jump to an agent's terminal, or
pause/resume it. No more flying blind across ten terminal tabs.

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

Alerts: 1 critical  1 warn
  ● data-pipeline    errored — last turn ended on a tool error
  ● web-app          waiting for input (AskUserQuestion)
```

> Replace this block with an animated demo — see [Recording a demo](#recording-a-demo).

---

## Try it in 10 seconds

```bash
# No install — see a demo fleet immediately:
npx agent-control-tower scan --sample

# Watch your real agents live in the terminal:
npx agent-control-tower

# Open the local web dashboard (live refresh, filtering, drill-down, cost trend):
npx agent-control-tower web        # → http://127.0.0.1:4517

# Re-render a past session's timeline from its transcript:
npx agent-control-tower replay <sessionId>
```

Nothing to configure. It finds your Claude Code sessions automatically and is **read-only** —
it never writes, moves, or deletes anything under `~/.claude`.

## Why this exists

As people run more **parallel** AI coding agents, the bottleneck shifts from *writing code*
to *supervising agents*. Today that means alt-tabbing between terminals and losing track of
who needs you and who's burning money. There's no good **open, local-first cockpit** for it —
commercial dashboards are cloud, closed, and want your data.

agent-control-tower is the missing cockpit: it reads the transcripts agents already write and
turns them into one live board — with alerting, history, replay, and safe controls. Private by
construction, useful in seconds.

## What you get

- **Live status per agent** — `working` · `waiting` (needs you) · `error` · `idle`, derived
  by a documented [state machine](PRD.md#6-agent-state-machine-the-core-spec), not guesswork.
- **What & how long** — the current tool (Bash, Edit, a spawned sub‑agent…) and the live
  duration of the current turn.
- **Tokens & cost** — per‑agent and fleet‑wide estimates, including sub‑agent spend, with a
  configurable pricing table (clearly labelled as an estimate), and a **cost‑over‑time** chart.
- **Configurable alerting** — rules for *errored*, *waiting‑for‑input*, *idle > N min*,
  *long‑running turn*, and *cost ≥ $X*, surfaced in **both** the TUI and the web.
- **Session replay** — re‑render any past session's state‑over‑time and timeline from its
  stored transcript. Optional history recorder for long‑range cost trends.
- **Real, safety‑gated management actions** — focus an agent's terminal, or **pause/resume**
  it (SIGSTOP/SIGCONT). Off by default, opt‑in with `--allow-control`, and refused unless the
  target is unambiguously resolved.
- **Source‑agnostic core** — a documented `SourceAdapter` interface. Claude Code is the
  reference adapter; a **generic JSONL/hook** adapter lets any framework feed the same core.
- **Two faces, one brain** — a terminal UI (Ink) and a local web dashboard render the *same*
  core. The web server exposes a small JSON API.

## How it works

```
~/.claude/projects/**/<session>.jsonl   ──▶  src/sources (read-only I/O)
   (or any source via a SourceAdapter)       │  discover · read · watch
                                              ▼
                                         src/core (pure, zero-I/O)
                          parser → FSM → cost → timeline → fleet → alerts → replay → trend
                                              │
                       ┌──────────────────────┼──────────────────────┐
                       ▼                       ▼                      ▼
                 Ink TUI (src/tui)     Web dashboard (src/web)   src/control (opt-in)
                                       Fastify JSON API + page   focus · pause · resume
```

`src/core` is a pure library with **no filesystem and no network** — it turns transcript
*strings* into agent state, so it's exhaustively unit‑tested (≥95% lines). `src/sources` is
the only code that reads disk; `src/history` writes only to an app *state* dir (never
`~/.claude`); `src/control` touches OS processes/terminals only.

## Commands

```
agent-control-tower [command] [options]

  tui            Live terminal board of all agents (default)
  scan           Print a one-shot snapshot and exit (great for pipes/cron)
  web            Serve the local web dashboard (127.0.0.1 only)
  replay <id>    Re-render a past session's timeline + state-over-time
  history        Show recorded fleet-history samples (see --record)
  help | version

Options:
  --sample              Use the bundled sample fleet (no real data needed)
  --root <dir>          Transcript root (default: per-source, e.g. ~/.claude/projects)
  --source <id>         Source adapter: claude-code (default) | generic-jsonl
  --json                (scan/replay/history) Emit JSON instead of a table
  --idle-ms <n>         Idle threshold in ms (default: 120000)
  --alert-idle-min <n>  Alert when an agent is idle > n minutes
  --alert-cost <usd>    Alert when an agent's est. cost ≥ $usd
  --alert-turn-min <n>  Alert when a turn runs > n minutes (default 15)
  --record              (scan) Append a fleet history sample
  --history-file <path> Override the history file location
  --allow-control       Enable real management actions: focus / pause / resume
  --port <n>            (web) Port to serve on (default: 4517)
  --no-color            Disable ANSI colors
```

In the TUI: `↑/↓` select · `enter` detail · `s` cycle sort · `r` refresh · `p` pause‑view ·
`f` focus · `z` pause (SIGSTOP) · `x` resume (SIGCONT) · `q` quit. Management actions require
`--allow-control`; otherwise they refuse with a clear message.

## HTTP API

The web server exposes a small read-only JSON API on `127.0.0.1` (the `POST` control endpoint
is registered **only** with `--allow-control`):

| Endpoint | Description |
|---|---|
| `GET /api/health` | version, root, source, sample flag, control state, counts |
| `GET /api/fleet` | fleet totals + every agent snapshot + alerts |
| `GET /api/alerts` | fired alerts + a severity summary |
| `GET /api/timeline?limit=N` | merged cross-agent timeline (most recent `N`) |
| `GET /api/agents/:id` | a single agent snapshot by session id (404 if unknown) |
| `GET /api/agents/:id/replay` | a session's reconstructed state-over-time + timeline |
| `GET /api/trend?bucketMs=N` | time-bucketed cumulative cost/token series |
| `GET /api/sources` | available source adapters + the active one |
| `POST /api/agents/:id/control` | `{ "action": "focus"\|"pause"\|"resume" }` — opt-in only |

## Other sources (adapters)

The core is normalized around a `SourceAdapter`. Besides `claude-code`, a framework‑neutral
**`generic-jsonl`** adapter reads one JSON object per line so any agent (or a hook script) can
feed the same board:

```jsonl
{"ts":"2026-06-16T10:00:00Z","session":"build-1","kind":"prompt","text":"ship it"}
{"ts":"...","session":"build-1","kind":"assistant","model":"gpt-x","stop":"tool_use","tools":[{"id":"t1","name":"shell"}],"usage":{"input":1000,"output":400}}
{"ts":"...","session":"build-1","kind":"tool_result","toolUseId":"t1","error":false}
{"ts":"...","session":"build-1","kind":"assistant","text":"done","stop":"end_turn"}
```

```bash
agent-control-tower scan --source generic-jsonl --root /path/to/sessions
```

Both adapters pass a shared, fixture‑backed [conformance suite](tests/sources/conformance.ts).

## Privacy & safety

**Local-first. Read-only on `~/.claude`. No telemetry. No accounts. No outbound network calls.** Ever.

- It only ever *reads* `~/.claude` — it never writes, mutates, or deletes your agent data. The
  optional history recorder writes solely to an app *state* dir (e.g. `~/.local/state/agent-control-tower`).
- The web server binds to `127.0.0.1` and is never exposed on the network.
- **Management actions act on OS processes/terminals only** — never on files — are **disabled
  by default**, are reversible (pause/resume via SIGSTOP/SIGCONT; terminal focus; no destructive
  kill), and are refused unless the target resolves to a single, non‑protected process.
- Verifiable from the source: the only filesystem reads live in `src/sources`, writes only in
  `src/history`, and process control only in `src/control`.

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
pnpm test            # 240+ unit/integration tests
pnpm test:cov        # coverage (≥95% lines on src/core)
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
- [x] M4 — launch polish
- [x] M5 — source-agnostic core (`SourceAdapter` + generic JSONL/hook adapter)
- [x] M6 — configurable alerting (TUI + web)
- [x] M7 — persistent history + session replay
- [x] M8 — real, safety-gated management actions (focus / pause / resume)
- [x] M9 — web dashboard upgrade (live refresh · filtering · drill-down · cost trend)
- [ ] More sources (native hook-event ingestion; first-class adapters for other frameworks)
- [ ] Per-project grouping & saved views

## License

MIT — see [LICENSE](LICENSE). Built in the open. PRs welcome.
