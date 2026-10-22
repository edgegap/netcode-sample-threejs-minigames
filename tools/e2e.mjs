#!/usr/bin/env node
// End-to-end test through the Edgegap matchmaker, the same path the browser clients take:
// tickets -> HOST_ASSIGNED -> wss to the deployment -> full match -> server stops itself.
//
//   MM_URL=https://<id>.edgegap.net MM_TOKEN=<matchmaker auth token> node tools/e2e.mjs [game ...]
//
// Uses the matchmaker's client token only (never the Edgegap API token). Each game queues
// several headless players at once and checks they all land on the same deployment.

import { playSession } from "./lib/bot.mjs";

const URL_ = (process.env.MM_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.MM_TOKEN;
if (!URL_ || !TOKEN) {
  console.error("Set MM_URL and MM_TOKEN (matchmaker API URL and Auth Token).");
  process.exit(1);
}
const PLAYERS = { blaster: 3, kart: 2, soccer: 4, cycles: 2, sumo: 3 };
const games = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PLAYERS);

let rateLimited = 0;
async function mm(method, path, body) {
  // Same backoff as client/lib/matchmaker.js: the matchmaker answers 429 to bursts.
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(URL_ + path, {
        method,
        headers: { Authorization: TOKEN, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      // Transient network error (DNS, reset): retry a few times like a 429.
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
    if (res.status === 429 && attempt < 8) {
      rateLimited++;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** Math.min(attempt, 3) + Math.random() * 500));
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    return res.json();
  }
}

async function queue(game, name, log) {
  const t0 = Date.now();
  const ticket = await mm("POST", "/tickets", { profile: game, attributes: {} });
  let status = "";
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const t = await mm("GET", `/tickets/${ticket.id}`);
    if (t.status !== status) log(`${name}: ${t.status} after ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    status = t.status;
    if (t.status === "HOST_ASSIGNED") {
      const a = t.assignment;
      return { ticketId: ticket.id, fqdn: a.fqdn, url: `wss://${a.fqdn}:${a.ports.gameport.external}`, waited: (Date.now() - t0) / 1000 };
    }
    if (t.status === "CANCELLED") throw new Error(`${name}: ticket cancelled`);
  }
}

/** After the match the deployment stops itself; wait until its port stops answering. */
async function waitForStop(fqdn, port, seconds = 90) {
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < seconds) {
    try {
      await fetch(`https://${fqdn}:${port}/`, { signal: AbortSignal.timeout(4000) });
    } catch {
      return (Date.now() - t0) / 1000;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

async function testGame(game) {
  const log = (m) => console.log(`[${game}] ${m}`);
  const names = Array.from({ length: PLAYERS[game] }, (_, i) => `e2e-${game}-${i + 1}`);
  const t0 = Date.now();
  const problems = [];
  const seats = await Promise.all(names.map((n, i) => new Promise((r) => setTimeout(r, i * 300)).then(() => queue(game, n, log))));
  const fqdns = new Set(seats.map((s) => s.fqdn));
  if (fqdns.size !== 1) problems.push(`players split across ${fqdns.size} deployments: ${[...fqdns].join(", ")}`);
  log(`all ${seats.length} assigned to ${seats[0].fqdn} (max wait ${Math.max(...seats.map((s) => s.waited)).toFixed(0)}s)`);

  const until = (r) => r.phases.includes("over") && r.result;
  const reports = await Promise.all(
    seats.map((s, i) => playSession({ url: s.url, game, name: names[i], ticket: s.ticketId, maxSeconds: 330, until }))
  );
  for (const r of reports) {
    if (r.error) problems.push(`${r.name}: ${r.error}`);
    if (!r.match) problems.push(`${r.name}: server did not see matchmaker env (MM_*)`);
    else if (r.match.players !== seats.length || r.match.profile !== game) problems.push(`${r.name}: match info ${JSON.stringify(r.match)}`);
    for (const p of ["countdown", "playing", "over"]) if (!r.phases.includes(p)) problems.push(`${r.name}: never saw ${p}`);
  }
  if (game === "soccer") {
    const teams = reports.map((r) => r.team);
    const counts = [0, 1].map((t) => teams.filter((x) => x === t).length);
    log(`matchmaker teams: ${teams.join(", ")}`);
    if (counts[0] !== counts[1]) problems.push(`uneven matchmaker teams ${teams.join(",")}`);
  }
  const result = reports[0].result;
  log(`result: ${result?.winner} (${reports[0].connectTries} connect try(s))`);

  const port = seats[0].url.split(":").pop();
  const stoppedAfter = await waitForStop(seats[0].fqdn, port);
  if (stoppedAfter === null) problems.push("deployment still answering 90s after the match");
  else log(`deployment stopped itself ${stoppedAfter.toFixed(0)}s after the match`);

  console.log(`${problems.length ? "FAIL" : "PASS"} ${game} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const p of problems) console.log(`     - ${p}`);
  return problems.length === 0;
}

// Games start 8 s apart so their ticket bursts don't all hit the matchmaker at once.
const results = await Promise.all(
  games.map((g, i) =>
    new Promise((r) => setTimeout(r, i * 8000)).then(() => testGame(g)).catch((e) => (console.log(`FAIL ${g}: ${e.message}`), false))
  )
);
if (rateLimited) console.log(`(matchmaker answered 429 ${rateLimited} time(s); retried)`);
console.log(results.every(Boolean) ? "\nALL PASSED" : "\nSOME FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
