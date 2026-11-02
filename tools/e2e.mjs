#!/usr/bin/env node
// End-to-end test through the Edgegap matchmaker, the same path the browser clients take:
// @edgegap/sdk group -> HOST_ASSIGNED -> wss to the deployment -> full match -> server stops itself.
//
//   MM_URL=https://<id>.edgegap.net MM_TOKEN=<matchmaker auth token> node tools/e2e.mjs [game ...]
//
// Uses the matchmaker's client token only (never the Edgegap API token). Each game queues
// several headless players at once and checks they all land on the same deployment.

import { getConnectionUrl } from "@edgegap/sdk";
import { GroupAgent } from "@edgegap/sdk/matchmaking";
import { playSession } from "./lib/bot.mjs";

const URL_ = process.env.MM_URL;
const TOKEN = process.env.MM_TOKEN;
if (!URL_ || !TOKEN) {
  console.error("Set MM_URL and MM_TOKEN (matchmaker API URL and Auth Token).");
  process.exit(1);
}
const PLAYERS = { blaster: 3, kart: 2, soccer: 4, cycles: 2, sumo: 3 };
const games = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PLAYERS);

async function queue(game, name, log) {
  const t0 = Date.now();
  const agent = new GroupAgent({ baseUrl: URL_, authToken: TOKEN, requestTimeoutSeconds: 15, pollingBackoffSeconds: 2, logGroupUpdates: false });
  agent.initialize(undefined, (_group, _type, _message, event) => {
    if (event.code === "updated") log(`${name}: ${event.status} after ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  });
  agent.createGroup({ profile: game, attributes: {}, is_ready: true }, true);
  try {
    const assignment = await agent.nextAssignment();
    return { ticketId: agent.group.current.ticket_id, fqdn: assignment.fqdn, url: getConnectionUrl(assignment, "gameport"), waited: (Date.now() - t0) / 1000 };
  } finally {
    agent.dispose();
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
console.log(results.every(Boolean) ? "\nALL PASSED" : "\nSOME FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
