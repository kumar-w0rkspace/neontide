# The Simulation

An animated story that plays in a band above the Claude Code prompt while Claude works. Everything
you see is being simulated: one loop is all the simulation can generate before it breaks. Then it
crashes, reboots as a new version, and runs again.

```
 ━━━━━━━━━━━━━━━━━━──────────────────────━━━━━━━━━━━━━━━━━━━
 ━━·∙≈≈≈≈≈≈≈≈≈≈≈≈≈≈╼▐{O}▌━━▶────✶───────────━━━━━━━━━━━━━━━━━━
 ━━━━━━━━━━━━━━━━━━━─────────────────────━━━━━━━━━━━━━━━━━━━
```

It is **neontide**, a Claude Code mod. It draws only in the terminal, using the full width of the
window, one to three rows tall.

## Turn it on and off

It is on as soon as the mod is installed.

| Type | Does |
|---|---|
| `/neontide` | Say whether it is on, and which chapter is playing |
| `/neontide off` | Stop it (it stays off until you turn it on again) |
| `/neontide on` | Start it again (it opens with its boot screen) |

- It shows **only while Claude is working**. When Claude stops, the band hides; when Claude starts
  again, it carries on.
- Only time Claude spends working counts, so a whole loop takes about **8 minutes of work**
  (in a 120-column window; a wider window makes the scanner chapter a little longer).
- It **remembers where it was**: in a new session, or after `/reload-plugins`, it boots again and then
  picks up at the same chapter.

## The story

The boot screen names the chapters in order, so the boot is the simulation loading what it is about
to play.

| Boot line | Chapter | What happens |
|---|---|---|
| `SIMULATION v1.4` | **Boot** | A cursor blinks, the title types out, and each boot line loads, unevenly, like real loading. The stability check stalls at 87% and blinks **WARN**. Then a short matrix rain, and the simulation begins. |
| `> loading signal` | **Scanner** | A beam sweeps the band, matrix-green first, then other colours. The last red beam splits in two, the pair crosses, and the final matrix beam dives head-on into the middle, where it splits again: two beams race out to the edges. |
| | **Equalizer** | The signal comes alive as bars, rising calm behind the two racing beams. The colour drifts from fire through cool blue to rainbow. |
| `> generating sky` | **Aurora** | The first thing the simulation makes is a sky: shimmering curtains in one continuous colour journey, twelve colours in about 30 seconds. |
| `> seeding life` | **Pac-man** | The sky can't hold. It burns out by itself, leaving bits that drift into a row of dots, and out of them comes the first living thing: a pac-man, born hungry. He eats through a maze with two ghosts behind him and goes round through the tunnel. |
| `> building space` | **The ship** | A ship builds round him, `·∙≈≈╼▐{C}▌━━▶`. He launches, the maze walls stream away, the ghosts fall behind. |
| | **Warp** | Faster and faster. The exhaust always grows first, then the stars speed up, and the ship surges forward and back with it. Before top speed the **afterburner** fires: the flame turns blue with shock diamonds `◆`, like a fighter jet. Then the **jump**: stars stretch into lines out of the core, the light blooms white, and the ship is a dark silhouette in it. |
| | **Space** | Out of hyperspace into a **nebula**. **Constellations** draw themselves as the sky drifts past, with shooting stars and a blinking satellite. A **starfield**. A **comet** streaks past underneath. A **planet** rises ahead. |
| `> forming weather` | **The dive and the storm** | The planet swells, thick clouds pile up, and the ship dives through them into the rain. The storm builds: drizzle, a downpour, a gale that buffets the ship, the cloud row flickering with sheet lightning until the whole sky lights up. At its peak, yellow forked bolts strike all around and thunder shakes the ship. Then a lull: the rain glints, the bolts drift far off. |
| `> igniting fire` | **The strike** | The sky lights up once more. Then the last and biggest bolt comes down onto the ship and it explodes. The pac-man is thrown clear and tumbles away. The wreck burns. |
| `> stability check… WARN` | **The end** | The fire melts into a rainbow plasma, the plasma corrupts into glitch, and after a short burst of it (about 2 seconds) the glitch crashes. |
| | **Reboot** | `ERROR : SIMULATION v1.4 FAILED`, then `RESTARTING v1.5...`, then matrix rain. The next loop starts straight away with the scanner (no boot screen between loops). |

The pac-man is the simulation's one character: born from the burnt-out sky, he travels through
everything it builds and escapes everything it destroys. Next loop he is seeded again.

### The version

The simulation's version is `v<session>.<loop>`:

- **The first number counts sessions.** Each Claude Code session that runs the simulation takes the
  next number the first time it does. If five sessions ran it yesterday, today's first one boots as
  `SIMULATION v6.0`.
- **The second number counts loops** in that session: every crash makes the next one, `v6.1`, `v6.2`…
  The reboot says which version failed and which one is restarting.
- A reload, or resuming a session, keeps that session's own number and loops.

The numbers are kept on your machine, across sessions and days.

### How long each chapter is

About, in a 120-column window, counting only the time Claude works:

| Chapter | Time |
|---|---|
| Boot (only when it starts) | 40 s |
| Scanner | 2½ min |
| Equalizer | 1 min |
| Aurora | 30 s |
| Pac-man and the ship | 12 s |
| Warp, the afterburner and the jump | 1 min |
| Nebula, constellations, starfield, comet | 20 s each |
| Planet and the dive | 10 s |
| The storm, the strike and the fire | 1 min |
| Plasma, glitch, crash and reboot | 27 s |
| **One loop** | **about 8 min** |

## What you need

- **Claude Code with neontide installed** (see the [README](README.md)).
- **A terminal.** The band draws in the terminal only, not in the desktop app or an editor's panel.
- **A font with box-drawing and block characters** (`━ ┃ ┏ ░ ▒ ▓ █ ▀ ▄ ◆ ✶ ✦ ✸ ✺`). Most modern
  terminal fonts have them: Cascadia Code (Windows Terminal's default), JetBrains Mono, Fira Code,
  Menlo, DejaVu Sans Mono.
- **24-bit colour** for the smooth fades (Windows Terminal, iTerm2, most Linux terminals). Older
  terminals show it with fewer colours.
- At least about **60 columns** wide; it looks best from about 100.

## Stop it completely

- `/neontide off` stops it.
- To switch the whole mod off: `/plugin`, then disable or uninstall neontide.
