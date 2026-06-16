# STATUS

Living status log for `agent-control-tower`. Newest first. Kept current every slice.

## Now
- **Milestone:** Shipped v0.1.0–v1.0.1. **Starting the v2.0.0 program** (M5→M10, one tag per
  milestone): source-agnostic core → alerting → history/replay → real management actions →
  web dashboard upgrade → adversarial review → `v2.0.0`.
- **State:** Baseline re-verified green before any v2 work — 107 tests, `src/core` 99.68% lines
  / 100% funcs, typecheck + lint clean, `pnpm build` ok, CLI runs vs `--sample` and real
  `~/.claude` (357 sessions, read-only). PRD.md updated with M5–M10 + specs §12–§15.

## M6 — Configurable alerting → v1.2.0 ✅
- ✅ Pure `evaluateAlerts(fleet, rules, now)` (`src/core/alerts.ts`, 100% lines): rule types
  `error` (critical), `waiting`-for-input (warn), `idle` > N min (info, opt-in), `long-turn`
  > N min (warn, default 15), `cost` ≥ $X (warn, opt-in). `resolveAlertRules`, `sortAlerts`,
  `summarizeAlerts` helpers. Added a clean `waitingForInput` boolean to the snapshot so the
  waiting rule never relies on reason-string matching.
- ✅ **100% unit-tested** (22 specs): every rule asserted to fire AND stay silent; threshold
  edges, rounding, missing-threshold (never-fires) branches, default-rule path, sort/summary.
- ✅ Surfaced in BOTH frontends: TUI alerts panel + per-row ▲ badge (`<Board/>`); web
  `/api/alerts` + alerts embedded in `/api/fleet` + a dashboard alert banner. `scan` prints an
  Alerts section (CI/cron-friendly).
- ✅ Configurable via `--alert-idle-min`, `--alert-cost`, `--alert-turn-min`
  (`alertRulesFromArgs`, threaded through scan/tui/web). Verified vs sample + real `~/.claude`.
- ✅ `build && typecheck && lint && test` green (180 tests); `src/core` 99.77% lines. 1.1.0→1.2.0.

## M5 — Source-agnostic core → v1.1.0 ✅
- ✅ `SourceAdapter` interface (`src/sources/adapter.ts`): `id`, `displayName`, `extension`,
  `defaultRoot()`, read-only `discover()`/`read()`, and a **pure** `parse()` (the conformance
  contract). Two adapters: `claude-code` (reference) + `generic-jsonl` (framework-neutral hook).
- ✅ Pure `parseGenericTranscript` (`src/core/generic.ts`, 100% lines) maps a documented JSONL
  schema (`kind: prompt|assistant|tool_result|system|turn_duration`) into the SAME normalized
  events, so FSM/cost/timeline are unchanged. Robust by the same contract as the Claude parser.
- ✅ Extracted read-only fs primitives to `src/sources/fs.ts` (no import cycle); `transcripts.ts`
  re-exports old symbols for back-compat. `loadFleetView`/`scanRoot` are adapter-aware;
  `--source <id>` selects the adapter across scan/tui/web; sample mode pins Claude Code.
- ✅ **Fixture-backed conformance suite** (`tests/sources/conformance.ts`): 7 canonical scenarios
  (working ×2 / waiting / error / idle / cost) authored in BOTH dialects, asserted against ONE
  shared expectation set — both adapters pass (14 specs). Plus generic-parser unit tests (16) and
  adapter registry + temp-dir discover/read integration (8).
- ✅ Verified: `build && typecheck && lint && test` green (147 tests); CLI run against a real
  generic temp dir AND real `~/.claude` (359 sessions, read-only). `src/core` 99.74% lines.
- ✅ version 1.0.1→1.1.0 (+ a package.json↔version.ts sync regression test).

## v2.0.0 — plan & decisions
- **Tag map:** v1.1.0 = M5 adapters · v1.2.0 = M6 alerting · v1.3.0 = M7 history/replay ·
  v1.4.0 = M8 control · v1.5.0 = M9 web upgrade · v2.0.0 = M10 review + launch.
- **Read-only promise kept:** management actions (M8) act on **OS processes/terminals only**,
  never on files under the scanned root; history recorder (M7) writes to a dedicated app
  state dir, never `~/.claude`. Web stays `127.0.0.1`, offline, no telemetry.
- **Execution strategy (recorded):** each milestone is implemented + verified directly in the
  main loop (spec → tests → code → `build && typecheck && lint && test` → run CLI/web vs
  fixtures *and* real `~/.claude`), because the work is tightly coupled and the rule is "never
  claim done without running it." The **mandatory multi-agent adversarial review** (goal #8)
  runs as a Workflow before v2.0.0; parallel agents are used opportunistically for independent
  drafting (docs/fixtures) where they don't fight over shared files.
- **Pure-core discipline:** new pure logic (generic parser, alerts, replay, trend) lives in
  `src/core/**` under the ≥95% coverage gate; I/O (adapters' discover/read, history writer,
  process control) lives in `src/sources` / `src/history` / `src/control` and is integration-tested.

## v1.0.1 — Adversarial-review fixes
Ran an 11-agent review (review → verify) over parser/FSM/cost/sources/web. Confirmed 6
findings; fixed 5, declined 1 with rationale:
- ✅ Parser emits **one event per `tool_result` block** (was collapsing batched results, losing
  toolUseId pairing). Real Claude Code never batches, so zero regression — robustness for
  parallel-tool / other-source transcripts.
- ✅ **Windows-safe** sessionId backfill in `readTranscript` (used a `/`-only basename).
- ✅ **`--root` now honored** by both TUI and web (root resolution moved into `loadFleetView`
  via `options.root`; was silently ignored).
- ✅ Watcher **re-entrancy guard** (overlapping slow polls could race on shared state).
- ✅ `/api/timeline?limit=0` returns `[]` (was `slice(-0)` → whole array).
- ⚖️ Declined: cache-aggregate→5m-tier attribution. 5m is the default TTL and real records
  always carry the split, so this fallback is effectively dead; clarified the comment instead.

## M4 — Done
- ✅ Excellent README: one-liner, embedded board demo, exact vhs/asciinema recording steps,
  one-line `npx` install, "why this exists", privacy section, HTTP API table, roadmap.
- ✅ Delightful empty state + `--sample` toggle in both frontends (TUI + web) — verified.
- ✅ `npx agent-control-tower` works from a clean pack: `prepack` builds; `files` ships
  `dist` + sample fixtures + README + LICENSE; installed `agent-control-tower`/`act` bins run.
- ✅ CONTRIBUTING.md, issue templates (bug/feature), PR template, demo/ (vhs tape + README +
  walkthrough.sh).

## M4 — Done
- ✅ Excellent README: one-liner, embedded board demo, exact vhs/asciinema recording steps,
  one-line `npx` install, "why this exists", privacy section, HTTP API table, roadmap.
- ✅ Delightful empty state + `--sample` toggle in both frontends (TUI + web) — verified.
- ✅ `npx agent-control-tower` works from a clean pack: `prepack` builds; `files` ships
  `dist` + sample fixtures + README + LICENSE; installed `agent-control-tower`/`act` bins run.
- ✅ CONTRIBUTING.md, issue templates (bug/feature), PR template, demo/ (vhs tape + README +
  walkthrough.sh).

## M3 — Done
- ✅ Fastify server (`src/web/server.ts`) with documented JSON API: `/api/health`,
  `/api/fleet`, `/api/timeline?limit=`, `/api/agents/:id`. Binds to `127.0.0.1` only.
- ✅ `createServer()` returns an un-listened app so tests hit the API via `inject` and
  assert the same core snapshot the TUI renders (6 specs).
- ✅ Self-contained dashboard (`src/web/public/index.html`, inline CSS/JS, dark theme):
  status chips + distribution bar, sortable agent table, cost-by-agent bars, live
  timeline; auto-refreshes every 3s. **No external CDN / no network** — chose CSS/SVG
  visuals over Chart.js to stay strictly offline & zero-dependency (documented deviation
  from the PRD's "Chart.js if needed").
- ✅ `--sample` serves the bundled fleet; build copies web assets into `dist` via
  `scripts/copy-assets.mjs`. Verified the real server over HTTP (curl health/fleet/page).

## M2 — Done

## M2 — Done
- ✅ `src/sources` (read-only): recursive session discovery, transcript reader, fleet/
  timeline loader, sample-fleet loader, and a polling watcher. Integration-tested vs the
  sample fleet + a temp-dir watcher test.
- ✅ `tests/fixtures/sample/`: committed 5-session sample fleet exercising every state
  (working / waiting / error / idle) plus a subagent; generated by `generate-sample.ts`.
- ✅ Ink TUI: pure `<Board/>` (status badge, current tool, turn duration, model, tokens,
  cost, last-activity) + stateful `<App/>` (initial load, fs-watch auto-refresh, clock
  tick for live durations, sort cycle, selection, detail panel, pause).
- ✅ `kill` / `focus` keys stubbed (emit intent) — displayed state is real; nothing signaled.
- ✅ `agent-control-tower` CLI: `tui` (default), `scan` (`--json`), `--sample`, `--root`,
  `--idle-ms`, `--no-color`, `help`, `version`. Degrades to `scan` when not a TTY.
- ✅ Headless render tests (ink-testing-library) for Board + App incl. a keypress test.

## Earlier — Done

## Done
- ✅ PRD.md written (problem, users, success criteria, scope/non-goals, data sources,
  FSM spec §6, cost spec §7, architecture, M1–M4 with Definition of Done).
- ✅ Researched real Claude Code transcript schema (read-only) to ground the event model,
  FSM, and cost estimator in actual data (record types, `usage` shape, `stop_reason`,
  tool blocks, `turn_duration` system records, sidechains, observed models).
- ✅ Scaffolded TypeScript toolchain (strict, ESM, NodeNext), ESLint 9 flat config,
  Vitest + v8 coverage (≥90% lines / ≥85% branches on `src/core`).
- ✅ GitHub repo `aymandakir-gh/agent-control-tower` created (MIT, public); CI workflow
  (typecheck · lint · test+coverage · build on Node 20 & 22) **green** on baseline.
- ✅ **M1 core** built and tested (63 tests, 99.5% lines / 100% funcs on `src/core`):
  - `types.ts` — normalized event model, snapshots, config.
  - `parser.ts` — robust JSONL→events (tolerant of malformed/unknown/partial lines).
  - `fsm.ts` — `deriveAgentState` implementing the §6 precedence table (one test per row).
  - `pricing.ts` + `cost.ts` — estimator with model resolution & unknown-model fallback.
  - `timeline.ts` — merged cross-agent timeline.
  - `fleet.ts` — aggregate snapshot + default sort.
  - `tests/fixtures/builder.ts` — programmatic realistic-transcript generator.

## Next
- [ ] Tag v0.1.0 (M1) via `gh release create`.
- [ ] M2: `src/sources` (read-only discovery + watcher) → Ink TUI live board.
- [ ] Generate static sample fixtures under `tests/fixtures/sample/` for `--sample`.

## Decisions (rationale captured for later review)
- **Project lives in `~/agent-control-tower`** (CWD `~` is the home dir, not empty; a
  dedicated repo folder keeps it clean and standalone).
- **Pure core / thin frontends**: all parsing/state/cost logic is I/O-free in `src/core`
  so it is 100% unit-testable; `src/sources` is the only place that touches the filesystem
  (read-only). Two frontends (Ink TUI, Fastify web) render the same core model.
- **Read-only guarantee**: the app never writes under `~/.claude`. Every write-path test
  uses generated fixtures in `tests/fixtures/`.
- **Cost is a labelled estimate** with a configurable pricing table; unknown models fall
  back to a tier and are flagged.
