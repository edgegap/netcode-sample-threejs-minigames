#!/usr/bin/env node
// Local parity test: starts each game server with short timers, plays a full match with two
// headless players, and checks the phases, the result and that every player saw the same match.
//   node tools/test-local.mjs [game ...]
// Against a running container instead: TEST_URL=ws://localhost:7777 node tools/test-local.mjs blaster

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { playSession } from "./lib/bot.mjs";

const ALL = ["blaster", "kart", "soccer", "cycles", "sumo"];
const games = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const root = resolve(import.meta.dirname, "..");

async function testGame(game, port) {
  let server = null;
  let url = process.env.TEST_URL;
  if (!url) {
    url = `ws://127.0.0.1:${port}`;
    server = spawn(process.execPath, ["server/main.js"], {
      cwd: root,
      env: { ...process.env, GAME: game, PORT: String(port), WAIT_SECONDS: "2", COUNTDOWN_SECONDS: "1", RESULTS_SECONDS: "1", MATCH_SECONDS: "40" },
    });
    server.stderr.on("data", (d) => process.stderr.write(`[${game}] ${d}`));
    await new Promise((r) => setTimeout(r, 400));
  }
  const until = (rep) => rep.phases.includes("over") && rep.result;
  const t0 = Date.now();
  const reports = await Promise.all(
    ["alice", "bob"].map((name) => playSession({ url, game, name: `${name}-${game}`, maxSeconds: 90, until }))
  );
  server?.kill();

  const problems = [];
  for (const r of reports) {
    if (r.error) problems.push(`${r.name}: ${r.error}`);
    for (const p of ["waiting", "countdown", "playing", "over"]) if (!r.phases.includes(p)) problems.push(`${r.name}: never saw ${p}`);
    if (!r.result?.winner) problems.push(`${r.name}: no result`);
  }
  const ids = reports.map((r) => r.id);
  if (new Set(ids).size !== ids.length) problems.push("duplicate player ids");
  const seen = reports[0].players.map((p) => p.id);
  for (const id of ids) if (!seen.includes(id)) problems.push(`player ${id} missing from the scoreboard`);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const bots = reports[0].players.filter((p) => p.bot).length;
  console.log(
    `${problems.length ? "FAIL" : "PASS"} ${game.padEnd(8)} ${secs}s, ${reports[0].players.length} players (${bots} bots), ` +
      `${reports[0].states} states, result: ${reports[0].result?.winner ?? "-"} [${(reports[0].result?.ranking ?? []).map((r) => `${r.name}:${r.score}`).join(" ")}]`
  );
  for (const p of problems) console.log(`     - ${p}`);
  return problems.length === 0;
}

const results = await Promise.all(games.map((g, i) => testGame(g, 18000 + i)));
process.exit(results.every(Boolean) ? 0 : 1);
