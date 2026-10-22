# Rocket Soccer

1v1 or 2v2 soccer on a small pitch. Push or dash the ball into the other goal. The team with more goals after **2 minutes** wins.

![Rocket Soccer](../../docs/images/soccer.jpg)

| | |
|---|---|
| Genre | Sports, teams |
| Players | 2–4 per match in 2 teams; bots even out the teams |
| Controls | WASD / arrows move · Space dash |
| Matchmaker profile | `soccer` (`team_count: 2`, 1–2 players per team) → app version `soccer-v1` |
| Local port | 7773 (`npm run dev:soccer`) |

## Teams from the matchmaker

This game shows the matchmaker's **teams**. The `soccer` profile has `team_count: 2`, so the matchmaker splits the players and gives every ticket a `team_id`. The deployment receives the tickets as `MM_TICKET_<id>` variables. The client sends its ticket ID in `hello`, and [`server/edgegap.js`](../../server/edgegap.js) maps it to team 0 (red, defends the left goal) or team 1 (blue).

Players who join without a ticket (local server or a direct deployment) go to the smaller team. Bots fill whichever side is short, so a 2v1 becomes a 2v2.

## What the server decides

[`server.js`](server.js) runs at 60 Hz and owns:
- player acceleration and speed caps;
- the dash: a 22 m/s burst with a 1.5 s cooldown;
- player-ball contact: the ball takes the player's speed along the contact normal, plus a kick;
- player bumps, walls and goals;
- kickoffs, with a 2 s pause;
- the score.

A goal adds to the scorer's personal score only when it goes in the other team's net. An own goal still counts for the other team, but nobody gets a personal point.

The client ([`client.js`](client.js)) sends `{mx, mz, dash}` and shows a broadcast camera that follows the ball.

## Tuning

`HALF_X`, `HALF_Z`, `GOAL_HALF`, `ACCEL`, `MAX_SPEED`, `DASH_SPEED`, `DASH_COOLDOWN` and `KICKOFF_PAUSE`; `config.matchSeconds` (120).
