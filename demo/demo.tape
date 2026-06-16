# vhs tape for the agent-control-tower demo GIF.
# Install vhs (https://github.com/charmbracelet/vhs), then run:  vhs demo/demo.tape
# Produces demo/demo.gif — drop it at the top of the README.

Output demo/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 760
Set Padding 18
Set Theme "Catppuccin Mocha"

# 1) One-shot snapshot of a demo fleet — statuses, cost, and alerts.
Type "npx agent-control-tower scan --sample"
Enter
Sleep 3.5s

# 2) Opt-in alert rules (idle + cost ceiling) light up more of the fleet.
Type "npx agent-control-tower scan --sample --alert-idle-min 10 --alert-cost 0.5"
Enter
Sleep 3.5s

# 3) Replay a past session's state-over-time from its stored transcript.
Type "npx agent-control-tower replay a1111111-working-bash --sample"
Enter
Sleep 3.5s

# To capture the live board instead, comment in:
#   Type "npx agent-control-tower --sample"
#   Enter
#   Sleep 4s
#   Type "q"

Sleep 2s
