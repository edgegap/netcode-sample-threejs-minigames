# Light Cycles

Grid survival in the style of Tron: every cycle leaves a wall of light behind it. Hit any wall and you're out. The last one riding wins the round, and the first to **3 rounds** wins the match.

![Light Cycles](../../docs/images/cycles.jpg)

| | |
|---|---|
| Genre | Arcade |
| Players | 2–6 per match; bots fill up to 4 |
| Controls | WASD / arrows: turn up, right, down, left |
| Matchmaker profile | `cycles` → app version `cycles-v1` |
| Local port | 7774 (`npm run dev:cycles`) |

## What the server decides

[`server.js`](server.js) steps a 48 × 48 grid 16 times a second, independent of the room's 30 Hz tick. On each step it:
- applies at most one turn per cycle, ignoring a turn back the way it came;
- moves every cycle one cell;
- crashes any cycle that enters a wall, a trail, or the same cell as another cycle (a head-on crash takes out both).

The round ends when one or no cycle is left, or when every human is out. The next round starts 2.5 s later.

Trails go over the wire as corner points (`[[x, z], ...]` plus the head), not as cells, so a snapshot stays a few hundred bytes for a whole round.

The client ([`client.js`](client.js)) sends only `{dir}` (0–3) when you press a key. It rebuilds a trail wall whenever that trail's corner list changes, follows your cycle while you ride, and shows the whole grid once you crash.

## Bots

Bots look up to 8 cells ahead, keep going straight while there's room, and otherwise turn toward the side with more space. A little randomness makes them crash eventually: smarter bots made rounds last 40 s.

## Tuning

`SIZE`, `STEP_HZ`, `ROUNDS_TO_WIN` and `ROUND_PAUSE`; `config.botFill` (4).
