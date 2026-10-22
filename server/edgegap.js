// Edgegap integration for one deployment = one match. Nothing in here runs off Edgegap.
//
// Edgegap injects ARBITRIUM_* variables into every deployment, and MM_* variables when the
// matchmaker created it. This module reads them and stops the deployment when the match is over:
// DELETE $ARBITRIUM_DELETE_URL with $ARBITRIUM_DELETE_TOKEN. Billing stops with it.

const env = process.env;

export const onEdgegap = !!env.ARBITRIUM_REQUEST_ID;
export const requestId = env.ARBITRIUM_REQUEST_ID ?? "local";

/** What the matchmaker told us about this match, or null for a direct deployment / local run. */
export const match = readMatch();

function readMatch() {
  if (!env.MM_TICKET_IDS) return null;
  let ids = [];
  try {
    ids = JSON.parse(env.MM_TICKET_IDS);
  } catch {
    return null;
  }
  // Each MM_TICKET_<id> holds the ticket: { id, profile, player_ip, group_id, team_id, attributes, ... }.
  const tickets = new Map();
  for (const id of ids) {
    try {
      tickets.set(id, JSON.parse(env[`MM_TICKET_${id}`] ?? "{}"));
    } catch {
      tickets.set(id, {});
    }
  }
  // Turn the matchmaker's team ids into 0, 1, 2... in a stable order.
  const teamIds = [...new Set([...tickets.values()].map((t) => t.team_id).filter(Boolean))].sort();
  const teamOf = (ticketId) => {
    const i = teamIds.indexOf(tickets.get(ticketId)?.team_id);
    return i < 0 ? null : i;
  };
  return { id: env.MM_MATCH_ID, profile: env.MM_MATCH_PROFILE, ticketIds: ids, tickets, teamOf };
}

export function describeDeployment() {
  if (!onEdgegap) return "local run (not on Edgegap): no self-stop, matches loop forever";
  return (
    `deployment ${requestId} at ${env.ARBITRIUM_PUBLIC_IP ?? "?"} ` +
    `(${env.ARBITRIUM_HOST_ID ?? "?"}), ` +
    (match ? `match ${match.id} profile ${match.profile}, ${match.ticketIds.length} ticket(s)` : "direct deploy")
  );
}

let stopping = false;

/** Ask Edgegap to stop this deployment. Edgegap then sends SIGTERM. */
export async function selfStop(reason) {
  if (!onEdgegap || stopping) return;
  stopping = true;
  log(`self-stop: ${reason}`);
  const url = env.ARBITRIUM_DELETE_URL;
  const token = env.ARBITRIUM_DELETE_TOKEN;
  if (!url || !token) {
    log("ARBITRIUM_DELETE_URL/TOKEN missing, exiting instead");
    process.exit(0);
  }
  try {
    const res = await fetch(url, { method: "DELETE", headers: { authorization: token } });
    log(`self-stop request: HTTP ${res.status}`);
    if (!res.ok) process.exit(0); // restart policy is Never, so exiting ends the deployment too
  } catch (err) {
    log(`self-stop request failed: ${err}`);
    process.exit(0);
  }
}

export function log(msg) {
  console.log(`[edgegap] ${msg}`);
}
