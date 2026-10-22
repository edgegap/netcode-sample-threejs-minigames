// Edgegap matchmaker client (matchmaker 3.x ticket API), called straight from the browser.
//
//   POST   {url}/tickets        { profile, attributes }  -> { id, status, ... }
//   GET    {url}/tickets/{id}   SEARCHING | MATCH_FOUND | HOST_ASSIGNED (+ assignment) | CANCELLED
//   DELETE {url}/tickets/{id}   leave the queue
//
// Header: Authorization: <matchmaker auth token>, raw (no "Bearer"/"token" prefix). That token is
// made to ship in game clients: it can create and read tickets, nothing else. The page's origin
// must be listed in the matchmaker config's allowed_cors_origins.

export class Matchmaker {
  constructor({ url, token, profile, attributes = {}, pollMs = 1500, portName = "gameport", onStatus = () => {} }) {
    this.url = url.replace(/\/+$/, "");
    Object.assign(this, { token, profile, attributes, pollMs, portName, onStatus });
    this.ticketId = null;
    this.cancelled = false;
    addEventListener("pagehide", () => this.cancel());
  }

  /** Queue one player. Resolves with { url: "wss://fqdn:port", ticketId, fqdn } once a server is assigned. */
  async findMatch() {
    this.cancelled = false;
    this.onStatus("Joining queue...");
    const ticket = await this.request("POST", "/tickets", { profile: this.profile, attributes: this.attributes });
    this.ticketId = ticket.id;
    const started = Date.now();

    while (!this.cancelled) {
      await new Promise((r) => setTimeout(r, this.pollMs));
      if (this.cancelled) break;
      const t = await this.request("GET", `/tickets/${encodeURIComponent(ticket.id)}`);
      const seconds = Math.round((Date.now() - started) / 1000);
      switch (t.status) {
        case "SEARCHING":
          this.onStatus(`Searching for players... ${seconds}s`);
          break;
        case "TEAM_FOUND":
        case "MATCH_FOUND":
          this.onStatus("Match found! Starting a server near you...");
          break;
        case "HOST_ASSIGNED": {
          const a = t.assignment;
          const port = Number(a?.ports?.[this.portName]?.external);
          if (!a?.fqdn || !port) throw new Error(`Assignment without ${this.portName}: ${JSON.stringify(a)}`);
          this.ticketId = null; // matched: a DELETE now would only get a 409
          // TLS Upgrade is on for the port, so connect by fqdn: the certificate matches it.
          return { url: `wss://${a.fqdn}:${port}`, ticketId: ticket.id, fqdn: a.fqdn };
        }
        case "CANCELLED":
          this.ticketId = null;
          throw new Error("The ticket expired before a match was found");
        default:
          throw new Error(`Unexpected ticket status ${t.status}`);
      }
    }
    throw new Error("Matchmaking cancelled");
  }

  cancel() {
    this.cancelled = true;
    if (!this.ticketId) return;
    const id = this.ticketId;
    this.ticketId = null;
    fetch(`${this.url}/tickets/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: this.token },
      keepalive: true,
    }).catch(() => {});
  }

  async request(method, path, body) {
    // The matchmaker rate-limits clients (HTTP 429): back off and retry instead of failing.
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url + path, {
        method,
        headers: { Authorization: this.token, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429 && attempt < 8) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** Math.min(attempt, 3) + Math.random() * 500));
        continue;
      }
      if (!res.ok) throw new Error(`Matchmaker ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
      return res.json();
    }
  }
}
