// Sumo Push: party brawler. Shove everyone off a shrinking ring; dash for a big hit.
// Last one standing wins the round, first to ROUNDS_TO_WIN round wins takes the match.

import { axisIn, ffaResult, r2 } from "../../server/util.js";

const RING_START = 14;
const RING_MIN = 5;
const SUDDEN_DEATH = 25; // seconds into a round: the ring keeps shrinking to nothing
const SHRINK_AFTER = 8; // seconds into a round
const SHRINK_RATE = 0.5; // m/s
const RADIUS = 1;
const ACCEL = 28;
const MAX_SPEED = 9;
const DASH_SPEED = 24;
const DASH_COOLDOWN = 1.8;
const ROUNDS_TO_WIN = 3;
const ROUND_PAUSE = 2.5;

export function createGame() {
  const bodies = new Map(); // id -> { x, z, y, vx, vz, vy, dash, out, input }
  let ring = RING_START;
  let roundTime = 0;
  let round = 0;
  let pause = 0;
  let roundWinner = null;

  function newRound() {
    round++;
    ring = RING_START;
    roundTime = 0;
    const list = [...bodies.values()];
    list.forEach((b, i) => {
      const a = (i / list.length) * Math.PI * 2;
      Object.assign(b, { x: Math.cos(a) * ring * 0.6, z: Math.sin(a) * ring * 0.6, y: 0, vx: 0, vz: 0, vy: 0, dash: 0.5, out: false });
    });
  }

  function botInput(id, b) {
    let target = null;
    let best = Infinity;
    for (const [oid, o] of bodies) {
      if (oid === id || o.out) continue;
      const d = (o.x - b.x) ** 2 + (o.z - b.z) ** 2;
      if (d < best) [best, target] = [d, o];
    }
    const fromCentre = Math.hypot(b.x, b.z);
    if (!target || fromCentre > ring - 1.5) {
      return { mx: -b.x / (fromCentre || 1), mz: -b.z / (fromCentre || 1), dash: false }; // back to the middle
    }
    const dx = target.x - b.x;
    const dz = target.z - b.z;
    const d = Math.sqrt(best) || 1;
    return { mx: dx / d, mz: dz / d, dash: d < 6 && Math.random() < 0.1 };
  }

  return {
    name: "sumo",
    config: { tickHz: 60, sendHz: 20, maxPlayers: 8, botFill: 4, matchSeconds: 180 },
    info: () => ({ ringStart: RING_START, roundsToWin: ROUNDS_TO_WIN }),

    addPlayer(p) {
      // Mid-round joiners wait out the round.
      bodies.set(p.id, { x: 0, z: 0, y: -50, vx: 0, vz: 0, vy: 0, dash: 0, out: true, input: { mx: 0, mz: 0, dash: false } });
    },
    removePlayer(p) {
      bodies.delete(p.id);
    },
    input(p, msg) {
      const b = bodies.get(p.id);
      if (b) b.input = { mx: axisIn(msg.mx), mz: axisIn(msg.mz), dash: !!msg.dash };
    },
    start() {
      round = 0;
      roundWinner = null;
      pause = 0;
      newRound();
    },

    update(dt, room) {
      if (pause > 0) {
        pause -= dt;
        if (pause <= 0) {
          roundWinner = null;
          newRound();
        }
        return;
      }
      roundTime += dt;
      if (roundTime > SHRINK_AFTER) ring = Math.max(roundTime > SUDDEN_DEATH ? 0 : RING_MIN, ring - SHRINK_RATE * dt);

      for (const [id, b] of bodies) {
        if (b.out) {
          // Falling: keep moving outward and drop.
          if (b.y > -50) {
            b.vy -= 30 * dt;
            b.y += b.vy * dt;
            b.x += b.vx * dt;
            b.z += b.vz * dt;
          }
          continue;
        }
        const p = room.players.get(id);
        const inp = p?.bot ? botInput(id, b) : b.input;
        const len = Math.hypot(inp.mx, inp.mz);
        const k = len > 1 ? 1 / len : 1;
        b.vx += inp.mx * k * ACCEL * dt;
        b.vz += inp.mz * k * ACCEL * dt;
        b.dash -= dt;
        if (inp.dash && b.dash <= 0 && len > 0.1) {
          b.dash = DASH_COOLDOWN;
          b.vx = (inp.mx / len) * DASH_SPEED;
          b.vz = (inp.mz / len) * DASH_SPEED;
        }
        const speed = Math.hypot(b.vx, b.vz);
        const dashing = b.dash > DASH_COOLDOWN - 0.3;
        if (!dashing && speed > MAX_SPEED) {
          b.vx *= MAX_SPEED / speed;
          b.vz *= MAX_SPEED / speed;
        }
        b.vx *= Math.exp(-2.5 * dt);
        b.vz *= Math.exp(-2.5 * dt);
        b.x += b.vx * dt;
        b.z += b.vz * dt;
      }

      // Elastic-ish bumps; a dashing player counts as three times heavier.
      const list = [...bodies.values()].filter((b) => !b.out);
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const c = list[j];
          const dx = c.x - a.x;
          const dz = c.z - a.z;
          const d = Math.hypot(dx, dz);
          if (d <= 0 || d >= RADIUS * 2) continue;
          const nx = dx / d;
          const nz = dz / d;
          const ma = a.dash > DASH_COOLDOWN - 0.3 ? 3 : 1;
          const mc = c.dash > DASH_COOLDOWN - 0.3 ? 3 : 1;
          const overlap = RADIUS * 2 - d;
          a.x -= nx * overlap * (mc / (ma + mc));
          a.z -= nz * overlap * (mc / (ma + mc));
          c.x += nx * overlap * (ma / (ma + mc));
          c.z += nz * overlap * (ma / (ma + mc));
          const rel = (a.vx - c.vx) * nx + (a.vz - c.vz) * nz;
          if (rel > 0) {
            const impulse = (2.6 * rel) / (ma + mc); // > 2: a little bouncier than physics
            a.vx -= impulse * mc * nx;
            a.vz -= impulse * mc * nz;
            c.vx += impulse * ma * nx;
            c.vz += impulse * ma * nz;
          }
        }

      for (const b of bodies.values()) if (!b.out && Math.hypot(b.x, b.z) > ring) b.out = true;

      const standing = [...bodies].filter(([, b]) => !b.out);
      // Once every human is out, the bot closest to the centre takes the round.
      const humansOut = room.humans().length > 0 && !standing.some(([id]) => !room.players.get(id)?.bot);
      if (bodies.size > 0 && (standing.length <= 1 || humansOut)) {
        standing.sort((a, b) => Math.hypot(a[1].x, a[1].z) - Math.hypot(b[1].x, b[1].z));
        const winner = standing[0] && room.players.get(standing[0][0]);
        if (winner) winner.score++;
        roundWinner = winner ? winner.name : "Nobody";
        pause = ROUND_PAUSE;
      }
    },

    result(room) {
      if (pause > 0 && pause < 1.5) {
        const champ = [...room.players.values()].find((p) => p.score >= ROUNDS_TO_WIN);
        if (champ) return ffaResult(room, ` with ${champ.score} rounds`);
      }
      return null;
    },
    timeUp: (room) => ffaResult(room),

    snapshot() {
      return {
        ring: r2(ring),
        round,
        roundWinner,
        p: [...bodies].map(([id, b]) => ({ id, x: r2(b.x), z: r2(b.z), y: r2(b.y), out: b.out, dash: b.dash > DASH_COOLDOWN - 0.3 })),
      };
    },
  };
}
