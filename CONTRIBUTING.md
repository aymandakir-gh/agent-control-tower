# Contributing

Thanks for your interest in agent-control-tower! It's a small, focused, **spec-driven**
project and contributions are welcome.

## Principles

1. **Spec-driven, not vibe-coded.** Every feature starts as an acceptance criterion in
   [`PRD.md`](PRD.md) (or `docs/specs/`) and ships with a test that proves it. No feature
   without a test.
2. **Pure core.** All parsing/state/cost/alert/replay/trend logic lives in `src/core` and must
   stay **I/O-free** (no filesystem, no network, no `Date.now()` baked in — pass the clock in).
   This keeps it 100% unit-testable. `src/sources` is the only code that *reads* disk and is
   strictly **read-only**; `src/history` is the only code that *writes*, and only to an app
   state dir; `src/control` touches OS processes/terminals only.
3. **Read-only on `~/.claude`, always.** The app must never write, move, or delete real agent
   data. All write-path tests use generated fixtures (`tests/fixtures/`) or temp dirs.
4. **Local-first & private.** No telemetry, no accounts, no outbound network calls. The web
   server binds `127.0.0.1`.
5. **Management actions are opt-in & safe.** Anything that signals a process must pass the pure
   `assessControl` gate, be reversible, and be off unless `--allow-control` is set.

## Getting started

```bash
pnpm install
pnpm test           # run the suite
pnpm test:watch     # TDD
pnpm typecheck
pnpm lint
pnpm build
node dist/cli.js scan --sample
```

Requires Node ≥ 20 and pnpm 9.

## The loop

1. Open (or comment on) an issue describing the change.
2. Add/adjust the acceptance criterion in `PRD.md` if behavior changes.
3. Write a failing test in `tests/` (use the fixture builder in
   `tests/fixtures/builder.ts` to construct realistic transcripts).
4. Implement until green. Keep `src/core` pure.
5. Run the full gauntlet locally — it mirrors CI exactly:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build
   ```
6. Use [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
7. Open a PR. CI (Node 20 & 22) must be green.

## Coverage

`src/core` must keep **≥ 90% line** and **≥ 85% branch** coverage (enforced by CI); in practice
it stays ≥ 95% lines. New core logic needs tests that assert **real behavior** — no padding.

## Project layout

```
src/core      pure domain library (parser, generic, fsm, cost, pricing, timeline, fleet,
              alerts, replay, trend, format)
src/sources   read-only filesystem layer (fs, source adapters, discovery, reading, watching)
src/history   opt-in fleet-history recorder (writes only to an app state dir)
src/control   real, safety-gated management actions (assess, fake, process, locate)
src/tui       Ink terminal UI
src/web       Fastify server + self-contained dashboard
src/cli.ts    CLI entry; src/cli/ has arg parsing + scan/replay/history commands
tests/        unit + integration tests; tests/fixtures/ has the builders + sample fleet;
              tests/sources/conformance.ts is the shared SourceAdapter conformance suite
```

## Reporting bugs / ideas

Use the issue templates. For parser issues, a minimal **fixture** (a few JSONL lines built
with the fixture builder, never real private data) is the most helpful thing you can include.
