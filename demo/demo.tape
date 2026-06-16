# vhs tape for the agent-control-tower demo GIF.
# Install vhs (https://github.com/charmbracelet/vhs), then run:  vhs demo/demo.tape
# Produces demo/demo.gif — drop it at the top of the README.

Output demo/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 720
Set Padding 18
Set Theme "Catppuccin Mocha"

# One-shot snapshot of a demo fleet (no real data needed).
Type "npx agent-control-tower scan --sample"
Enter
Sleep 3s

# Then the live board (q to quit). Comment this in once you've recorded.
# Type "npx agent-control-tower --sample"
# Enter
# Sleep 4s
# Type "q"

Sleep 2s
