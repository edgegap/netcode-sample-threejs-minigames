# Sumo Push

Party brawler on a shrinking ring. Shove everyone off the edge, and dash for a heavy hit. The last one standing wins the round, and the first to **3 rounds** wins the match.

![Sumo Push](../../docs/images/sumo.jpg)

| | |
|---|---|
| Genre | Party |
| Players | 2–8 per match; bots fill up to 4 |
| Controls | WASD / arrows move · Space dash |
| Matchmaker profile | `sumo` → app version `sumo-v1` |
| Local port | 7775 (`npm run dev:sumo`) |

## What the server decides

[`server.js`](server.js) runs at 60 Hz and owns:
- movement with friction;
- the dash: 24 m/s with a 1.8 s cooldown, and for 0.3 s the dasher counts as three times heavier, so it wins collisions;
- bumps between players, slightly bouncier than real physics;
- falling off the edge;
- rounds.

The ring starts at 14 m. From 8 s into a round it shrinks down to 5 m, and after 25 s sudden death shrinks it to nothing, so every round ends. Once every human is out, the bot closest to the centre takes the round.

The client ([`client.js`](client.js)) sends `{mx, mz, dash}` and draws the ring at the radius the server sends.

## Tuning

`RING_START`, `RING_MIN`, `SHRINK_AFTER`, `SHRINK_RATE`, `SUDDEN_DEATH`, `DASH_SPEED`, `DASH_COOLDOWN` and `ROUNDS_TO_WIN`.
