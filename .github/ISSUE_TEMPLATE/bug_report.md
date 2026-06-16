---
name: Bug report
about: Something isn't working
title: "bug: "
labels: bug
---

**What happened?**
A clear description of the bug.

**Expected**
What you expected instead.

**Repro**
Steps, command, and flags. If it's a parsing/state issue, the most helpful thing is a
**minimal fixture** — a few JSONL lines built with `tests/fixtures/builder.ts`
(please don't paste real private transcripts).

```jsonl
{ ... }
```

**Environment**
- agent-control-tower version: (`agent-control-tower version`)
- Node version:
- OS:

**Notes**
Anything else. Remember: this tool is read-only on `~/.claude` — it never modifies your data.
