# Demo assets

Everything here regenerates the README demo deterministically — no real agent data needed.

## Option A — vhs (recommended, produces a GIF)

[vhs](https://github.com/charmbracelet/vhs) records a terminal from a script ("tape"), so the
demo is reproducible and diff-able.

```bash
brew install vhs        # or see the vhs README for your platform
vhs demo/demo.tape      # writes demo/demo.gif
```

Then reference `demo/demo.gif` at the top of the root `README.md`.

## Option B — asciinema (produces a cast you can embed/play)

```bash
asciinema rec demo/demo.cast -c "node dist/cli.js --sample"
# press q to quit the TUI, which stops the recording
```

Upload with `asciinema upload demo/demo.cast`, or embed the `.cast` with the asciinema player.

## Option C — the scripted walkthrough

`demo/walkthrough.sh` runs a short, narrated sequence against the sample fleet — handy for a
screen recording or for sanity-checking the build.

```bash
pnpm build
bash demo/walkthrough.sh
```

## Recording tips

- Use the bundled sample fleet (`--sample`) so the board always shows all four states
  (working / waiting / error / idle) plus a sub-agent.
- A terminal ~1200px wide keeps the table on one line.
- Keep it short (10–15s): a snapshot, then the live board, then `q`.
