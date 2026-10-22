// Game server entry point. One process runs one game, picked by the GAME env var:
//   GAME=blaster node server/main.js
// It listens for WebSocket connections on PORT (default 7777). On Edgegap the app version maps
// that port as "gameport" with TLS Upgrade, so browsers connect with wss://<fqdn>:<external port>.

import http from "node:http";
import { WebSocketServer } from "ws";
import { Room } from "./room.js";
import { describeDeployment, log, onEdgegap, selfStop } from "./edgegap.js";

const GAMES = ["blaster", "kart", "soccer", "cycles", "sumo"];
const gameName = process.env.GAME;
if (!GAMES.includes(gameName)) {
  console.error(`Set GAME to one of: ${GAMES.join(", ")}`);
  process.exit(1);
}
const { createGame } = await import(`../games/${gameName}/server.js`);
const room = new Room(createGame());

const port = Number(process.env.PORT ?? 7777);
const server = http.createServer((req, res) => {
  // Plain HTTP answers with a status line: handy for curl and for Edgegap's port check.
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`${gameName} ${room.phase} ${room.humans().length} player(s)\n`);
});
new WebSocketServer({ server }).on("connection", (ws) => room.accept(ws));
server.listen(port, () => {
  log(`${gameName} server listening on :${port}`);
  log(describeDeployment());
});

// Edgegap sends SIGTERM when the deployment stops (self-stop, dashboard, API or max duration).
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    log(`${sig}: closing`);
    for (const p of room.humans()) p.ws?.close(1001, "server stopping");
    setTimeout(() => process.exit(0), 200);
  });
}
if (onEdgegap) process.on("uncaughtException", (err) => (console.error(err), selfStop("crash")));
