# agent-control-tower — Product Requirements

> A local-first **control tower** for fleets of AI coding agents.
> Observe and steer many parallel Claude Code (and similar) agents from one screen,
> instead of flying blind across 10 terminal tabs.

Status: **living document**. Every feature begins as an acceptance criterion here (or in
`docs/specs/`) and ships with a test that proves it. No feature without a test.

---

## 1. Problem

As individuals and teams run more **parallel** AI coding agents, the bottleneck moves
from *writing code* to *supervising agents*. Today you supervise by alt-tabbing between
terminals, each showing one agent. You cannot answer simple questions at a glance:

- Which agents are **working**, which are **idle**, which are **waiting on me**, which **errored**?
- What is each agent **doing right now** (which tool), and for **how long**?
- How many **tokens / how much money** has this fleet burned today?
- What happened **across all agents** in the last 10 minutes, on one timeline?

There is no good **open, local-first cockpit** for this. Commercial dashboards are cloud,
closed, and want your data. Builders running agents locally deserve a tool that reads what
is already on disk and shows them the fleet — privately, instantly, for free.

## 2. Users

- **Solo builders** running 3–10 Claude Code agents across projects/worktrees.
- **Small teams** sharing a machine or reviewing a teammate's local fleet over a screen-share.
- **Agent tinkerers** who want a real, inspectable data model of agent activity to build on.

Primary user persona: *"I have five agents going. I tab between terminals and lose track.
I want one screen that tells me who needs me and who's burning money."*

## 3. Success criteria

A release is successful if:

1. **Zero-config truth.** Run one command; within seconds you see every Claude Code session
   on the machine with a correct live status (idle / working / waiting / error), current
   tool, current-turn duration, and a token/cost estimate — with **no setup**.
2. **Correctness is provable.** The state of any agent is a pure function of its transcript +
   a clock. Given a fixture transcript, the derived state, timeline, and cost are asserted by
   tests. `src/core` has strong coverage (target ≥ 90% lines).
3. **Two faces, one brain.** A terminal UI (Ink) and a local web dashboard render the *same*
   core data model. The web server exposes an HTTP API that tests hit directly (headless).
4. **Delightful first run.** `npx agent-control-tower` shows something real in < 3 seconds,
   even with zero agents (empty state + a `--sample` toggle that loads bundled fixtures).
5. **Private by construction.** Read-only on `~/.claude`. No telemetry. No outbound network.
   Verifiable from the code and stated loudly in the README.

## 4. Scope

### In scope
- Discover Claude Code sessions from `~/.claude/projects/**/<session>.jsonl` (configurable root).
- Parse transcripts into a normalized, versioned **event model** (pure, no I/O).
- Derive per-agent **state** via a documented finite-state machine (pure).
- Estimate **tokens & cost** per agent and for the fleet, from `usage` blocks (pure).
- Build a unified **cross-agent timeline** of notable events (pure).
- **TUI**: live board (status / tool / turn duration / cost), auto-refresh, sort, detail view.
  `kill` / `focus` actions are **stubbed** (print intent) — state shown is real.
- **Web dashboard**: sortable table + timeline + cost over the HTTP API. Self-contained page.
- Live updates via filesystem watching (debounced), plus a manual refresh.

### Non-goals (explicit)
- ❌ **Writing/mutating** real `~/.claude` data. The app is **strictly read-only** there.
  All write-path tests use generated fixtures under `tests/fixtures/`.
- ❌ Actually killing/steering live agent processes in v0.x (`kill`/`focus` are stubs that
  emit intent; real control is a post-1.0 roadmap item gated behind explicit opt-in).
- ❌ Cloud sync, accounts, multi-machine aggregation, telemetry, or any outbound network call.
- ❌ Being a perfectly accurate billing system. Cost is a clearly-labelled **estimate** with
  a configurable, documented pricing table.
- ❌ Supporting every agent framework on day one. Claude Code transcripts are the M1 source;
  the event model is designed so other sources can be adapted later.

## 5. Data sources

| Source | Path | Mode | Notes |
|---|---|---|---|
| Claude Code transcripts | `~/.claude/projects/<slug>/<sessionId>.jsonl` | **read-only** | One JSONL file per session; appended live. Primary source. |
| (future) Hook events | `~/.claude/**` hook logs | read-only | Roadmap; the event model leaves room. |

### Transcript record shapes (observed from real data, v2.1.x)
JSONL, one record per line. Records carry common envelope fields: `type`, `uuid`,
`parentUuid`, `timestamp` (ISO-8601), `sessionId`, `cwd`, `gitBranch`, `version`,
`isSidechain`, and often a human-readable `slug`. Relevant `type`s:

- **`assistant`** — `message: { model, role, content[], stop_reason, usage }`.
  - `content[]` blocks: `thinking`, `text`, `tool_use { id, name, input }`.
  - `stop_reason`: `tool_use` | `end_turn` | `stop_sequence`.
  - `usage`: `{ input_tokens, output_tokens, cache_creation_input_tokens,
    cache_read_input_tokens, cache_creation: { ephemeral_5m_input_tokens,
    ephemeral_1h_input_tokens } }`.
- **`user`** — `message.content` is either a string (human prompt) or an array containing
  `tool_result { tool_use_id, is_error, content }` blocks (tool output fed back).
- **`system`** — `subtype`s include `turn_duration` (`{ durationMs, messageCount }`),
  `stop_hook_summary`, `local_command`, `informational`, `turn_duration`, etc.
- Other types seen and **tolerated** (ignored unless useful): `attachment`,
  `queue-operation`, `last-prompt`, `file-history-snapshot`, `mode`, `permission-mode`,
  `ai-title`, `custom-title`, `started`, `result`.
- **Sidechains** (`isSidechain: true`, with `agentId`) are subagent turns spawned by a
  parent session (e.g. via the `Task`/`Agent` tool).

**Robustness requirement:** the parser must never throw on unknown record types,
missing fields, malformed JSON lines, or partially-written trailing lines (live append).
Unknown/garbage lines are skipped and counted, not fatal.

Models observed: `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-fable-5`, `<synthetic>`.

## 6. Agent state machine (the core spec)

State is a **pure function** `deriveAgentState(events, now, config) -> AgentSnapshot`.
States: `idle | working | waiting | error`. Determined from the event tail:

| Precedence | Condition | State |
|---|---|---|
| 1 | Last assistant turn issued a tool_use for an **interactive** tool (`AskUserQuestion`) with no matching `tool_result` yet | `waiting` |
| 2 | There is an **unresolved** `tool_use` (assistant requested a tool, no `tool_result` yet) — agent is executing a tool | `working` |
| 3 | Last assistant message has `stop_reason === "tool_use"` (expecting tool results) | `working` |
| 4 | Last record is a **human prompt** with no assistant reply yet (agent about to respond) | `working` |
| 5 | The most recent turn ended on an **error** (last `tool_result.is_error === true` and the turn then ended, or an error system record) and nothing succeeded after | `error` |
| 6 | Last turn completed (`end_turn`) and last activity is **older than `idleMs`** | `idle` |
| 7 | Last turn completed (`end_turn`) **recently** (within `idleMs`) — agent finished, awaiting next human prompt | `waiting` |

`config` defaults: `idleMs = 120_000` (2 min). All thresholds configurable.
The snapshot also reports: `currentTool` (name of pending/last tool), `turnStartedAt`,
`turnDurationMs` (now − turnStartedAt for active turns; recorded duration for finished ones),
`lastActivityAt`, `model`, `messageCount`, token totals, and estimated cost.

A **turn** begins at the human prompt (or first assistant message after the previous turn
completed) and ends at the next `end_turn`. `turnStartedAt` is the timestamp of the event
that began the in-progress (or most recent) turn.

## 7. Cost estimation (spec)

`estimateCost(usage, model, pricing?) -> { usd, breakdown }`, pure. Pricing is a table of
USD-per-million-tokens with fields `{ input, output, cacheWrite5m, cacheWrite1h, cacheRead }`.
Defaults ship a best-effort public-rate table (clearly labelled **estimates**, overridable):

| Model | input | output | cacheWrite5m | cacheWrite1h | cacheRead |
|---|---|---|---|---|---|
| claude-opus-4-8 | 15 | 75 | 18.75 | 30 | 1.50 |
| claude-sonnet-4-6 | 3 | 15 | 3.75 | 6 | 0.30 |
| claude-haiku-4-5 | 1 | 5 | 1.25 | 2 | 0.10 |
| claude-fable-5 | 3 | 15 | 3.75 | 6 | 0.30 |
| `<synthetic>` | 0 | 0 | 0 | 0 | 0 |

Unknown models fall back to the Sonnet tier and are flagged `estimated: true` so the UI can
mark them "~". Cost = Σ over assistant turns of
`input·inP + output·outP + cacheWrite5m·cw5 + cacheWrite1h·cw1 + cacheRead·crP` (per MTok).

## 8. Architecture

- **`src/core`** — pure, zero-I/O, 100% unit-testable: `types`, `parser`, `fsm`, `cost`,
  `pricing`, `timeline`, `fleet` (aggregate snapshots). Input is always *strings* and
  plain objects; never touches the filesystem or network.
- **`src/sources`** — the only I/O for reading data: enumerate session files under a root,
  read their contents (READ-ONLY), and a debounced watcher. Feeds strings into `core`.
- **`src/tui`** — Ink frontend over core + sources.
- **`src/web`** — Fastify server exposing an HTTP API over core + sources; serves a
  self-contained static dashboard (Chart.js is the only allowed vendored dependency).
- **`src/cli.ts`** — entry point. `agent-control-tower [tui|web|scan] [--sample] [--root ...]`.

Stack: TypeScript (strict) + Node 20+, pnpm, Vitest, ESLint. Ink for TUI; Fastify + Vite
(build step for the web asset) for the dashboard.

## 9. Milestones & Definition of Done

### M1 — Core (pure library) + fixtures + green CI  → tag `v0.1.0` ✅ shipped
- [x] Repo created, MIT license, CI (install, typecheck, lint, test) **green** before features.
- [x] `src/core/types.ts`: normalized event model + `AgentSnapshot`/`FleetSnapshot`.
- [x] `parser.ts`: robust JSONL → events; tolerates malformed/unknown lines (tested).
- [x] `fsm.ts`: `deriveAgentState` implements §6; every row of the table has a fixture test.
- [x] `cost.ts` + `pricing.ts`: implements §7; tested incl. unknown-model fallback.
- [x] `timeline.ts`: merged, time-sorted cross-agent timeline (tested).
- [x] `fleet.ts`: aggregate many sessions → `FleetSnapshot` (tested).
- [x] `tests/fixtures/`: generated, realistic JSONL covering each state + a multi-agent fleet.
- [x] `src/core` coverage ≥ 90% lines. Full suite green locally and in CI.

### M2 — Ink TUI  → tag `v0.2.0` ✅ shipped
- [x] `src/sources`: read-only session discovery + watcher (integration-tested vs fixtures).
- [x] Live board: one row per agent with status badge, current tool, turn duration, model, cost.
- [x] Auto-refresh on file change; manual `r` refresh; sort by status/duration/cost/project.
- [x] Detail view for a selected agent (reason, token breakdown, subagents).
- [x] `kill` / `focus` keys are **stubbed** (emit intent line) — state is real.
- [x] Renders correctly against a fixture root in a headless snapshot test (ink-testing-library).

### M3 — Web dashboard over HTTP API  → tag `v0.3.0` ✅ shipped
- [x] Fastify server with documented JSON API: `/api/fleet`, `/api/agents/:id`, `/api/timeline`,
      `/api/health`. **Tests hit the API directly** (no browser) and assert the same core data.
- [x] Self-contained dashboard page: sortable agent table + timeline + cost bars.
      *(Decision: used inline CSS/SVG charts instead of Chart.js — keeps the page strictly
      offline & zero-dependency, satisfying "no external CDN" more strictly.)*
- [x] `--sample` serves bundled fixtures so the page is alive with zero real agents.
- [x] No external CDN/network; assets served locally; binds to 127.0.0.1. Read-only.

### M4 — Launch polish  → tag `v1.0.0`
- [ ] Excellent README: one-liner, animated demo placeholder + exact vhs/asciinema record steps,
      one-line install (`npx agent-control-tower`), "why this exists", privacy, roadmap.
- [ ] Delightful empty state + `--sample` data toggle in both frontends.
- [ ] `npx agent-control-tower` works from a clean checkout/pack.
- [ ] `CONTRIBUTING.md`, issue/PR templates, screenshots/GIF instructions, demo script.

## 10. Quality bar / workflow (non-negotiable)
- **Spec-driven**: feature ⇒ acceptance criterion (here or `docs/specs/`) ⇒ test ⇒ code.
- **Self-verify every slice**: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`, and run
  the actual CLI/web against `tests/fixtures/`. Never claim it works without running it.
- **Conventional commits**, push to `main` often, tag releases per milestone.
- **STOP** only before destructive/irreversible actions. Read-only on real `~/.claude`.

## 11. Privacy
Local-first. Read-only on `~/.claude`. No telemetry. No accounts. **No outbound network calls.**
Everything runs and stays on your machine. This is a load-bearing product promise.
