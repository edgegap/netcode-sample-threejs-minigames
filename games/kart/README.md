# Kart Rally

Arcade racing: **3 laps** around a bean-shaped circuit. The race ends when every player has finished, or 20 s after the winner crosses the line.

![Kart Rally](../../docs/images/kart.jpg)

| | |
|---|---|
| Genre | Racing |
| Players | 1–8 per match, no bots (racing alone is a time trial) |
| Controls | W / ↑ accelerate · S / ↓ brake and reverse · A D / ← → steer |
| Matchmaker profile | `kart` → app version `kart-v1` |
| Local port | 7772 (`npm run dev:kart`) |

## What the server decides

[`server.js`](server.js) owns:
- kart physics: acceleration, braking, rolling drag, and steering that depends on speed;
- the track surface: more than 5 m from the centreline is grass, where top speed drops from 24 to 9 m/s;
- the outer barrier and kart-to-kart bumps;
- laps and the finishing order.

The track is a closed centreline of 96 points, sent once in `welcome.info`. The client builds the road, kerbs and start line from it, so if you change the track shape in `server.js`, everyone sees the new track.

Reversing over the line doesn't count a lap: crossing the start only counts after passing the halfway checkpoint. The live position ("1st of 4") comes from the lap count plus progress along the centreline.

The client ([`client.js`](client.js)) sends `{throttle, steer}`, each in [-1, 1], and follows its kart with a chase camera.

## Tuning

At the top of `server.js`: `LAPS`, `HALF_WIDTH`, `MAX_SPEED`, `GRASS_SPEED`, `ACCEL`, `BRAKE`, `FINISH_GRACE`, and the `TRACK` formula.
