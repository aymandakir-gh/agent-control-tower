# STATUS

Living status log for `agent-control-tower`. Newest first. Kept current every slice.

## Now
- **Milestone:** M1 — Core (pure library) + fixtures + green CI. **COMPLETE** → tagging v0.1.0.
- **State:** Core library built and fully tested; CI green; about to tag the M1 release.

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
