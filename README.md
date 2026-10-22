# Three.js Minigames on Edgegap

Five small browser multiplayer games, one per genre, built with [Three.js](https://threejs.org) and plain
Node.js WebSocket servers. Every match runs on its own **authoritative dedicated server on Edgegap**,
started by the **Edgegap matchmaker** near the players and stopped by the server itself when the match ends.

| Game | Genre | Players | What the server owns |
|---|---|---|---|
| [Blaster Arena](games/blaster) | Top-down shooter | 2–8, bots fill to 3 | movement, bullets, hits, respawns, first to 10 kills |
| [Kart Rally](games/kart) | Racing | 1–8 | kart physics, grass/barriers, laps via checkpoint, finishing order |
| [Rocket Soccer](games/soccer) | Sports (teams) | 1v1 / 2v2, teams from the matchmaker | ball and player physics, goals, kickoffs |
| [Light Cycles](games/cycles) | Arcade | 2–6, bots fill to 4 | grid steps, trails, crashes, rounds |
| [Sumo Push](games/sumo) | Party | 2–8, bots fill to 4 | pushes, dashes, shrinking ring, rounds |

The clients only send inputs (keys, aim) and draw what the server sends, so the game rules can't be
changed from the browser.

```
browser --POST /tickets {profile: "kart"}--> Edgegap Matchmaker --deploys kart-v1 near the players--> Edgegap
browser <--HOST_ASSIGNED {fqdn, ports.gameport.external}-- Matchmaker
browser --wss://<fqdn>:<port>--> Node.js game server (one per match) --DELETE $ARBITRIUM_DELETE_URL--> stops itself
```

## Layout

```
games/<game>/server.js     the game's simulation (runs on the server only)
games/<game>/client.js     the game's Three.js rendering and input
games/<game>/index.html    the page (Three.js from a CDN through an import map, no build step)
server/                    shared server: room/phases (room.js), Edgegap lifecycle (edgegap.js), entry point (main.js)
client/lib/                shared client: menu + HUD + stage (shell.js), matchmaker client, WebSocket helper
client/config.js           matchmaker URL and Auth Token for every game
edgegap/                   matchmaker config, direct-deploy script
tools/                     local dev server, local tests, end-to-end test through the matchmaker
Dockerfile                 one image with every game server; GAME=<game> picks one
```

A game plugs into the shared room with a small object: `config`, `info()`, `addPlayer`, `removePlayer`,
`input`, `start`, `update(dt)`, `result()` / `timeUp()` and `snapshot()`. The room handles connections,
the phases (`waiting → countdown → playing → over`), bots, the 20 Hz state broadcast and the Edgegap lifecycle.

## Play locally

Needs Node.js 20+.

```bash
npm install
npm run dev:all          # five game servers on :7771-7775 + the pages on http://localhost:8080
```

Open http://localhost:8080, pick a game, and click **Local server**. Open a second tab to play against
yourself. `npm test` plays a full match of every game with two headless players.

## Host it on Edgegap

### 1. Image and app versions

```bash
docker login registry.edgegap.com
docker build --platform linux/amd64 -t registry.edgegap.com/<project>/threejs-minigames:<tag> .
docker push registry.edgegap.com/<project>/threejs-minigames:<tag>
```

In the Edgegap dashboard (or with the Edgegap MCP server), create the application `threejs-minigames` and
one **app version per game**, all on the same image:

| Setting | Value |
|---|---|
| Version name | `blaster-v1`, `kart-v1`, `soccer-v1`, `cycles-v1`, `sumo-v1` |
| Image | `registry.edgegap.com/<project>/threejs-minigames:<tag>` + your Container Registry username/token |
| Port | `7777`, protocol **WS**, name `gameport`, **TLS Upgrade on** (browsers need `wss://`) |
| Env var | `GAME` = `blaster` / `kart` / `soccer` / `cycles` / `sumo` |
| Resources | 0.25 vCPU / 512 MB is plenty |
| Max duration | 30 minutes (a safety net; servers stop themselves) |

Check one version with a direct deployment before adding the matchmaker:

```bash
EDGEGAP_API_TOKEN=<your API token> node edgegap/deploy.mjs threejs-minigames sumo-v1
# prints wss://<id>.pr.edgegap.net:<port>; open http://localhost:8080/games/sumo/?server=<that url>
```

The API token controls your whole Edgegap organization: keep it on your machine or backend, never in the
browser or the image.

### 2. Matchmaker

In the dashboard: **Matchmaker → Create Matchmaker**, upload [`edgegap/matchmaker-config.json`](edgegap/matchmaker-config.json),
**Create and Start**. It has one profile per game, each pointing at that game's version:

- `blaster`, `kart`, `cycles`, `sumo`: one team of 2–8 (2–6 for cycles), and after 20 s a single player
  gets a server alone (bots fill in).
- `soccer`: `team_count: 2` with 1–2 players per team, so the matchmaker makes 2v2 when it can, else 1v1,
  and gives each ticket a `team_id`. The server reads the teams from `MM_TICKET_<id>` and puts each player
  on their team. Start team profiles at `min_team_size: 1`: with `min_team_size: 2` and a 20 s expansion
  to 1, a 1v1 only formed when the tickets were about to expire (5 min). A lone soccer player is never
  matched: use **Local server** to play against a bot.
- `allowed_cors_origins` lists the origins that serve the pages: `http://localhost:8080` and
  `https://edgegap.github.io`. Add yours.

Copy the matchmaker's **API URL** and **Auth Token** into `client/config.js` (or a git-ignored
`client/config.local.js` with the same shape, or `?mm=<url>&token=<token>` on the page URL). The Auth Token
is made to ship in game clients; it can only create and read tickets.

Now **Find match** works on every game page: two browser tabs that click it within 20 s land on the same server.

### 3. End-to-end test

```bash
MM_URL=https://<id>.edgegap.net MM_TOKEN=<matchmaker auth token> npm run e2e
```

For each game it queues several headless players at once, checks they all get the same deployment, plays a
full match, checks the server saw the matchmaker's tickets (and, for soccer, even teams), and waits for the
deployment to stop itself.

## How the server lives on Edgegap

`server/edgegap.js` and `server/room.js`:

- **Waiting**: the server knows how many players were matched (`MM_TICKET_IDS`) and starts as soon as all of
  them joined, or 15 s after the first one did (`WAIT_SECONDS`). Clients send their ticket ID in `hello`.
  `REQUIRE_TICKET=1` on the version refuses anyone who wasn't matched to this server.
- **Self-stop** (`DELETE $ARBITRIUM_DELETE_URL`): 12 s after the match ends (results screen), when nobody
  joined within 120 s (`FIRST_JOIN_TIMEOUT_S`, e.g. a player closed the tab after being matched), or when
  everyone left for 30 s (`EMPTY_TIMEOUT_S`). Off Edgegap none of this runs and matches loop forever.
- **Connecting**: right after `HOST_ASSIGNED` a fresh deployment can refuse connections for a few seconds,
  so the client retries the WebSocket 10 times, 1 s apart.
- **Rate limits**: the matchmaker answers `429` to bursts of ticket calls; the client backs off and retries.

## Shipping a new build

Push a new tag, then either point each version at it (`docker_tag`, no matchmaker change needed while the
version names stay the same) or create `*-v2` versions and update `application.version` in the matchmaker
(Stop → Edit → Start). Running matches keep their old build.

## License

MIT. Three.js is loaded from jsDelivr (MIT).
