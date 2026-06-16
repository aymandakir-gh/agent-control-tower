# Contributing

Thanks for your interest in agent-control-tower! It's a small, focused, **spec-driven**
project and contributions are welcome.

## Principles

1. **Spec-driven, not vibe-coded.** Every feature starts as an acceptance criterion in
   [`PRD.md`](PRD.md) (or `docs/specs/`) and ships with a test that proves it. No feature
   without a test.
2. **Pure core.** All parsing/state/cost logic lives in `src/core` and must stay **I/O-free**
   (no filesystem, no network, no `Date.now()` baked in — pass the clock in). This keeps it
   100% unit-testable. The only code that touches disk is `src/sources`, and it is strictly
   **read-only**.
3. **Read-only on `~/.claude`, always.** The app must never write, move, or delete real agent
   data. All write-path tests use generated fixtures under `tests/fixtures/`.
4. **Local-first & private.** No telemetry, no accounts, no outbound network calls.

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

`src/core` must keep **≥ 90% line** and **≥ 85% branch** coverage (enforced by CI). New core
logic needs tests.

## Project layout

```
src/core      pure domain library (parser, fsm, cost, pricing, timeline, fleet, format)
src/sources   read-only filesystem layer (discovery, reading, watching)
src/tui       Ink terminal UI
src/web       Fastify server + self-contained dashboard
src/cli.ts    CLI entry + arg parsing
tests/        unit + integration tests; tests/fixtures/ has the builder + sample fleet
```

## Reporting bugs / ideas

Use the issue templates. For parser issues, a minimal **fixture** (a few JSONL lines built
with the fixture builder, never real private data) is the most helpful thing you can include.
