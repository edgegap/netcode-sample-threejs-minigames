// Headless test player: connects like the browser client (hello -> welcome -> state stream) and
// plays with simple per-game inputs, so tests can drive full matches without a browser.

import WebSocket from "ws";

const inputs = {
  blaster: (me, s, t) => {
    const enemy = s.p.find((p) => p.id !== me.id && p.alive);
    const self = s.p.find((p) => p.id === me.id);
    const aim = enemy && self ? Math.atan2(enemy.x - self.x, enemy.z - self.z) : t;
    return { mx: Math.sin(t * 0.7), mz: Math.cos(t * 0.5), aim, fire: true };
  },
  kart: (me, s, t, info) => {
    // Steer toward a point a few segments ahead on the centreline.
    const k = s.k.find((k) => k.id === me.id);
    if (!k) return { throttle: 0, steer: 0 };
    const pts = info.track;
    let best = 0;
    let bd = Infinity;
    pts.forEach((p, i) => {
      const d = (p.x - k.x) ** 2 + (p.z - k.z) ** 2;
      if (d < bd) [bd, best] = [d, i];
    });
    const target = pts[(best + 4) % pts.length];
    let diff = Math.atan2(target.x - k.x, target.z - k.z) - k.h;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return { throttle: 1, steer: Math.max(-1, Math.min(1, -diff * 3)) };
  },
  soccer: (me, s, t) => {
    const self = s.p.find((p) => p.id === me.id);
    if (!self) return { mx: 0, mz: 0, dash: false };
    const dx = s.ball.x - self.x;
    const dz = s.ball.z - self.z;
    const d = Math.hypot(dx, dz) || 1;
    return { mx: dx / d, mz: dz / d, dash: d < 3 };
  },
  cycles: (me, s, t) => ({ dir: Math.floor(t / 1.5) % 4 }),
  sumo: (me, s, t) => {
    const self = s.p.find((p) => p.id === me.id);
    if (!self) return { mx: 0, mz: 0, dash: false };
    const r = Math.hypot(self.x, self.z) || 1;
    if (r > s.ring - 3) return { mx: -self.x / r, mz: -self.z / r, dash: false };
    return { mx: Math.sin(t), mz: Math.cos(t * 1.3), dash: Math.random() < 0.02 };
  },
};

/**
 * Play one game session. Resolves with a report once the server closes the connection
 * (match over + self-stop), or after `maxSeconds`, or when `until(report)` returns true.
 */
export function playSession({ url, game, name, ticket, maxSeconds = 300, until = () => false, attempts = 15, log = () => {} }) {
  return new Promise((resolve) => {
    const report = { url, name, id: null, connectTries: 0, phases: [], states: 0, result: null, players: [], error: null, closeCode: null };
    let tries = 0;
    let done = false;
    const finish = (ws) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(loop);
      try {
        ws?.close();
      } catch {}
      resolve(report);
    };
    let ws = null;
    let loop = null;
    let latest = null;
    let info = {};
    const started = Date.now();
    const timer = setTimeout(() => {
      report.error ??= `timeout after ${maxSeconds}s`;
      finish(ws);
    }, maxSeconds * 1000);

    const attempt = () => {
      tries++;
      report.connectTries = tries;
      ws = new WebSocket(url);
      ws.on("open", () => ws.send(JSON.stringify({ t: "hello", name, ticket })));
      ws.on("error", () => {});
      ws.on("message", (data) => {
        const msg = JSON.parse(data);
        if (msg.t === "welcome") {
          report.id = msg.id;
          report.team = msg.team;
          report.match = msg.match;
          info = msg.info;
          log(`${name}: welcome as #${msg.id} after ${tries} try(s)`);
          loop = setInterval(() => {
            if (!latest || latest.phase !== "playing") return;
            const t = (Date.now() - started) / 1000;
            ws.send(JSON.stringify({ t: "input", ...inputs[game]({ id: report.id }, latest.s, t, info) }));
          }, 50);
        } else if (msg.t === "state") {
          latest = msg;
          report.states++;
          report.players = msg.players;
          if (report.phases.at(-1) !== msg.phase) {
            report.phases.push(msg.phase);
            log(`${name}: phase ${msg.phase}`);
          }
          if (msg.result) report.result = msg.result;
          if (until(report)) finish(ws);
        } else if (msg.t === "error") {
          report.error = msg.message;
          finish(ws);
        }
      });
      ws.on("close", (code) => {
        report.closeCode = code;
        if (done) return;
        if (!report.id && tries < attempts) return setTimeout(attempt, 1000);
        finish(ws);
      });
    };
    attempt();
  });
}
