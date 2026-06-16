# STATUS

Living status log for `agent-control-tower`. Newest first. Kept current every slice.

## Now
- **Milestone:** M1 — Core (pure library) + fixtures + green CI.
- **State:** Bootstrapping — PRD written, repo initialized.

## Done
- ✅ PRD.md written (problem, users, success criteria, scope/non-goals, data sources,
  FSM spec §6, cost spec §7, architecture, M1–M4 with Definition of Done).
- ✅ Researched real Claude Code transcript schema (read-only) to ground the event model,
  FSM, and cost estimator in actual data (record types, `usage` shape, `stop_reason`,
  tool blocks, `turn_duration` system records, sidechains, observed models).

## Next
- [ ] Scaffold TypeScript project (package.json, tsconfig, eslint, vitest).
- [ ] Create GitHub repo + CI workflow; get CI green on a trivial test before features.
- [ ] Build M1 core: types → parser → fsm → cost → timeline → fleet, each with tests.
- [ ] Generate realistic fixtures under tests/fixtures/.
- [ ] Tag v0.1.0 when M1 Definition of Done is met.

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
