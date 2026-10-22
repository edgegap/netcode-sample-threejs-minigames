# How it works

Each match is one Node.js process in one Edgegap deployment. The browser never runs game rules: it sends inputs and draws what the server sends.

```
                  ┌───────────── Edgegap ─────────────┐
 browser ──POST /tickets {profile:"sumo"}──▶ Matchmaker
 browser ◀─HOST_ASSIGNED {fqdn, ports.gameport.external}─┤
                  │   deploys sumo-v1 near the players │
 browser ══wss://<id>.pr.edgegap.net:<port>══▶ server/main.js (GAME=sumo)
                  │                    └─ DELETE $ARBITRIUM_DELETE_URL when the match is over
                  └────────────────────────────────────┘
```

## Server

| File | Role |
|---|---|
| [`server/main.js`](../server/main.js) | Picks the game from `GAME`, serves HTTP + WebSocket on `PORT` (7777), handles SIGTERM. |
| [`server/room.js`](../server/room.js) | Game-agnostic match: connections, handshake, phases, fixed-rate simulation, 20 Hz state broadcast, bots, timers. |
| [`server/edgegap.js`](../server/edgegap.js) | Reads Edgegap's `ARBITRIUM_*` and the matchmaker's `MM_*` variables; `selfStop()`. Does nothing off Edgegap. |
| [`server/util.js`](../server/util.js) | Input sanitising, collision helpers, result helpers. |
| `games/<game>/server.js` | The game's rules. |

### Wire protocol

JSON text frames.

| Direction | Message |
|---|---|
| client → server | `{t:"hello", name, ticket}`: first message. `ticket` is the matchmaker ticket ID (absent in local or direct mode). |
| client → server | `{t:"input", ...}`: the game's input fields, up to ~30 per second. |
| server → client | `{t:"welcome", id, team, game, match, info}`: your player ID and team, the match (`{id, profile, players}` or `null`), and static game data (map, track). |
| server → client | `{t:"state", phase, timer, waitingFor, players, result, s}`: 20 times a second. `players` = `[{id, name, score, team, bot}]`, `s` = the game's snapshot. |
| server → client | `{t:"error", message}`, then close: server full, match finished, or (with `REQUIRE_TICKET=1`) unknown ticket. |

### Phases

`waiting → countdown → playing → over`

- **waiting**: until every player the matchmaker put in this match has connected (`MM_TICKET_IDS`), or `WAIT_SECONDS` after the first one did. Then bots are added if the game wants them.
- **countdown**: `COUNTDOWN_SECONDS`. The game places everyone; inputs are ignored.
- **playing**: the game's `update(dt)` runs at its tick rate until `result()` returns a winner or `MATCH_SECONDS` runs out.
- **over**: results stay on screen for `RESULTS_SECONDS`, then the server stops its deployment. Locally the room goes back to `waiting`.

### Edgegap lifecycle

The server stops its own deployment (`DELETE $ARBITRIUM_DELETE_URL` with `Authorization: $ARBITRIUM_DELETE_TOKEN`) when:
- the match is over (after the results screen);
- nobody connected within `FIRST_JOIN_TIMEOUT_S`, for example when a matched player closed the tab;
- every human left and nobody came back within `EMPTY_TIMEOUT_S`.

Edgegap then sends SIGTERM; `main.js` closes the sockets and exits. Node runs as PID 1 in the container (`CMD ["node", "server/main.js"]`), so the signal reaches it. Each app version also has a 30-minute max duration as a safety net.

### Environment variables

Set these on the app version; all are optional except `GAME`.

| Variable | Default | Meaning |
|---|---|---|
| `GAME` | — | `blaster`, `kart`, `soccer`, `cycles` or `sumo` |
| `PORT` | 7777 | Internal port (the app version maps it as `gameport`) |
| `WAIT_SECONDS` | 15 | Start this long after the first join even if matched players are missing |
| `COUNTDOWN_SECONDS` | 3 | Countdown before play |
| `MATCH_SECONDS` | per game | Time limit |
| `RESULTS_SECONDS` | 12 | Results screen before the server stops |
| `FIRST_JOIN_TIMEOUT_S` | 120 | Stop if nobody ever connects |
| `EMPTY_TIMEOUT_S` | 30 | Stop after everyone has left |
| `REQUIRE_TICKET` | off | `1` refuses players whose ticket isn't in this match |

Edgegap injects the rest: `ARBITRIUM_REQUEST_ID`, `ARBITRIUM_PUBLIC_IP`, `ARBITRIUM_DELETE_URL`, `ARBITRIUM_DELETE_TOKEN`... and, on matchmaker deployments, `MM_MATCH_ID`, `MM_MATCH_PROFILE`, `MM_TICKET_IDS`, `MM_TICKET_<id>` (with `team_id`), `MM_TEAMS`. The server logs the match on boot:

```
[edgegap] deployment 942526380cdf at 66.228.40.59 (newark-...), match 01a1644d-... profile blaster, 3 ticket(s)
```

## Client

| File | Role |
|---|---|
| [`client/lib/shell.js`](../client/lib/shell.js) | Everything the games share: the Three.js stage, the menu (Find match, Local server, `?server=`), the HUD, input sending, name labels, entity syncing and easing helpers. |
| [`client/lib/matchmaker.js`](../client/lib/matchmaker.js) | Ticket API client: create, poll, cancel, back off on `429`. |
| [`client/lib/net.js`](../client/lib/net.js) | WebSocket with the `hello` handshake and connection retries. |
| [`client/config.js`](../client/config.js) | Matchmaker URL and Auth Token. |
| `games/<game>/client.js` | Builds the level from `welcome.info`, draws snapshots, reads the keyboard and mouse. |

No build step: each page loads Three.js 0.170 from jsDelivr through an import map, and everything else is plain ES modules.

Rendering: snapshots arrive 20 times a second, and each object eases toward its latest server position every frame (`smooth(dt)` = `1 - e^(-14·dt)`). Respawns and kickoffs snap instead. That adds roughly 50–100 ms of visual delay, which is fine for these games, and needs no client-side prediction.

### Find match

1. `POST /tickets {profile: "<game>", attributes: {}}` with header `Authorization: <matchmaker auth token>`.
2. Poll `GET /tickets/{id}` every 1.5 s: `SEARCHING` → `MATCH_FOUND` (a server is starting) → `HOST_ASSIGNED` with `assignment.fqdn` and `assignment.ports.gameport.external`.
3. Connect to `wss://<fqdn>:<external>`. The port has TLS Upgrade, so the page can be `https`, and the FQDN matches the certificate.
4. A fresh deployment can refuse the first connections for a few seconds, so `net.js` retries 10 times, 1 s apart.

Cancel sends `DELETE /tickets/{id}` (also on tab close). A `429` from the matchmaker means too many calls at once, so the client waits 1, 2, 4, then 8 s and retries.

## Matchmaker

[`edgegap/matchmaker-config.json`](../edgegap/matchmaker-config.json): one profile per game, each pointing at its app version.

| Profile | Teams × size | Notes |
|---|---|---|
| `blaster`, `kart`, `sumo` | 1 × 2–8 | after 20 s a lone player gets a server (bots fill in) |
| `cycles` | 1 × 2–6 | same |
| `soccer` | 2 × 1–2 | 1v1 or 2v2, `team_id` per ticket |

What we measured on 2026-10-22: one-team profiles matched 2–3 players in 12–16 s; four soccer tickets made a 2v2 in 4–6 s. With `min_team_size: 2` plus an expansion to 1, two or three soccer tickets only matched when they were about to expire (5 min), so the soccer profile starts at 1.
