#!/usr/bin/env node
// Local development: run game servers (each on its own port) plus the static web server.
//   node tools/dev.mjs blaster            -> server :7771 + http://localhost:8080/games/blaster/
//   node tools/dev.mjs blaster kart ...   -> several at once
// In each game's menu, "Local server" connects to the matching port.

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const PORTS = { blaster: 7771, kart: 7772, soccer: 7773, cycles: 7774, sumo: 7775 };
const root = resolve(import.meta.dirname, "..");
const games = process.argv.slice(2);
if (!games.length || games.some((g) => !PORTS[g])) {
  console.error(`Usage: node tools/dev.mjs <${Object.keys(PORTS).join("|")}> [...]`);
  process.exit(1);
}

const children = [];
const run = (label, args, env = {}) => {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env } });
  const prefix = (chunk) => chunk.toString().trimEnd().split("\n").map((l) => `[${label}] ${l}`).join("\n");
  child.stdout.on("data", (d) => console.log(prefix(d)));
  child.stderr.on("data", (d) => console.error(prefix(d)));
  children.push(child);
};

for (const g of games) run(g, ["server/main.js"], { GAME: g, PORT: String(PORTS[g]) });
run("web", ["tools/serve.mjs"]);
for (const g of games) console.log(`${g}: http://localhost:8080/games/${g}/`);
process.on("SIGINT", () => {
  for (const c of children) c.kill();
  process.exit(0);
});
