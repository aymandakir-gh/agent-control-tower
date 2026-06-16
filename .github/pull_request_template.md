<!-- Thanks for contributing! Keep PRs focused. -->

## What & why
<!-- What does this change and why? Link the issue. -->

## Acceptance criterion
<!-- The spec/criterion this satisfies (PRD.md or docs/specs/). -->

## Checklist
- [ ] Behavior change is reflected in `PRD.md` / `docs/specs/` if applicable
- [ ] Added/updated tests that prove the criterion
- [ ] `src/core` stayed pure (no I/O); read-only guarantee on `~/.claude` intact
- [ ] `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build` all green locally
- [ ] Conventional commit title (`feat:`/`fix:`/`docs:`/…)

## Notes
<!-- Screenshots for UI changes, trade-offs, follow-ups. -->
