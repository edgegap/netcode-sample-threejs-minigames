# Adding a game

A sixth game takes four files and four small edits. The room, lifecycle, matchmaker client and HUD are shared.

## 1. Server: `games/<name>/server.js`

Export `createGame()` returning this object. [`games/sumo/server.js`](../games/sumo/server.js) is a compact example.

```js
export function createGame() {
  return {
    name: "<name>",
    config: { tickHz: 30, sendHz: 20, maxPlayers: 8, botFill: 2, matchSeconds: 180 },
    info() {},               // static data sent once in "welcome": map, sizes, rules
    addPlayer(p, room) {},   // p = { id, name, bot, team, score, ticket }; may run in any phase
    removePlayer(p, room) {},
    input(p, msg) {},        // validate every field: clamp axes, check enums, coerce booleans
    start(room) {},          // reset and place everyone for a new match
    update(dt, room) {},     // the rules, only while "playing"
    result(room) {},         // null, or { winner: "text", ranking } to end early
    timeUp(room) {},         // { winner, ranking } when the time limit hits
    snapshot(room) {},       // what clients draw, 20 times a second; keep it small
    // botsNeeded(room) {},  // optional: how many bots to add at start
  };
}
```

Rules of thumb that kept the five games honest:
- Clients send intents (axes, an aim angle, buttons, a direction). The server owns speed, cooldowns, collisions, damage, scores and the end of the match. `util.js` has `axisIn()` to sanitise an axis.
- Write scores to `p.score`: the scoreboard and `ffaResult()` read it.
- A player can join mid-match. Spawn them at once (shooter, racer) or park them until the next round (cycles, sumo).
- Round-based games keep their rounds inside `playing`, with a pause timer between rounds.
- Round numbers (`r2()`), send only what's drawn, and send shapes as corner points rather than cells.

## 2. Client: `games/<name>/client.js` and `index.html`

Copy `index.html` from another game and change the title. In `client.js`:

```js
import * as THREE from "three";
import { runGame, EntityMap, makeLabel, colorOf, smooth, axis } from "../../client/lib/shell.js";

runGame({
  game: "<name>",            // also the matchmaker profile name
  title: "…", tagline: "…", help: "WASD move",
  create({ scene, camera, myId, info, input }) {
    // build the level from info, then:
    return {
      state(msg) { /* keep msg; msg.s is your snapshot */ },
      frame(dt) { /* ease meshes toward msg.s, move the camera, input({ mx, mz }) */ },
      dispose() { /* remove the level */ },
    };
  },
});
```

`EntityMap` keeps one mesh per server entity (created and removed as the snapshot changes), and `smooth(dt)` gives the easing factor.

## 3. Wiring

- `server/main.js`: add the name to `GAMES`.
- `Dockerfile`: add a `COPY games/<name>/server.js ...` line.
- `client/lib/shell.js`: add a local port to `LOCAL_PORTS`; `tools/dev.mjs` and `package.json`: the same port and a `dev:<name>` script.
- `index.html` (the game list): add a card.

## 4. Test, then host

1. `npm run dev:<name>`, then two tabs on **Local server**.
2. Add an input function for the game to `tools/lib/bot.mjs`, then `npm test <name>` plays a full match with two headless players.
3. Build and push a new image tag, then create an app version `<name>-v1` (same image, `GAME=<name>`, port 7777 WS with TLS Upgrade, registry credentials).
4. Add a `<name>` profile to `edgegap/matchmaker-config.json` and update the matchmaker in the dashboard.
5. Add the game and its player count to `PLAYERS` in `tools/e2e.mjs`; `MM_URL=… MM_TOKEN=… npm run e2e <name>` then checks the whole path on Edgegap.
