// Kart Rally: arcade racing, 3 laps around a closed circuit. The server integrates every kart,
// keeps them on the track, counts laps through a halfway checkpoint and ranks the finish.

import { angleIn, axisIn, clamp, r2 } from "../../server/util.js";

const LAPS = 3;
const SEGMENTS = 96;
const HALF_WIDTH = 5;
const MAX_SPEED = 24;
const GRASS_SPEED = 9;
const ACCEL = 16;
const BRAKE = 30;
const REVERSE_MAX = 6;
const KART_RADIUS = 1;
const FINISH_GRACE = 20; // seconds the race continues after the first kart finishes

// Closed centreline: a bean-shaped circuit, sampled into SEGMENTS points.
const TRACK = Array.from({ length: SEGMENTS }, (_, i) => {
  const t = (i / SEGMENTS) * Math.PI * 2;
  return { x: r2(34 * Math.cos(t) + 6 * Math.cos(3 * t)), z: r2(22 * Math.sin(t) - 5 * Math.sin(2 * t)) };
});

/** Nearest point on the centreline: segment index, fraction along it, distance to it. */
function locate(x, z) {
  let best = { i: 0, f: 0, d: Infinity };
  for (let i = 0; i < SEGMENTS; i++) {
    const a = TRACK[i];
    const b = TRACK[(i + 1) % SEGMENTS];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const f = clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz), 0, 1);
    const d = Math.hypot(x - (a.x + abx * f), z - (a.z + abz * f));
    if (d < best.d) best = { i, f, d, cx: a.x + abx * f, cz: a.z + abz * f };
  }
  return best;
}

export function createGame() {
  const karts = new Map(); // id -> { x, z, h, v, seg, half, lap, finished, input }
  let time = 0;
  let order = []; // finishing order: { id, time }

  function grid(room) {
    // Grid behind the start line (segment 0), two karts per row, facing the direction of travel.
    const a = TRACK[0];
    const b = TRACK[1];
    const h = Math.atan2(b.x - a.x, b.z - a.z);
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    [...karts.values()].forEach((k, n) => {
      const row = Math.floor(n / 2) + 1;
      const side = n % 2 ? 1.8 : -1.8;
      Object.assign(k, {
        x: a.x - fx * row * 3.5 + fz * side,
        z: a.z - fz * row * 3.5 - fx * side,
        h, v: 0, seg: SEGMENTS - 1, half: false, lap: 0, finished: null,
      });
    });
  }

  return {
    name: "kart",
    config: { tickHz: 30, sendHz: 20, maxPlayers: 8, botFill: 0, matchSeconds: 240 },
    info: () => ({ track: TRACK, halfWidth: HALF_WIDTH, laps: LAPS }),

    addPlayer(p, room) {
      karts.set(p.id, { input: { throttle: 0, steer: 0 } });
      grid(room);
    },
    removePlayer(p) {
      karts.delete(p.id);
      order = order.filter((o) => o.id !== p.id);
    },
    input(p, msg) {
      const k = karts.get(p.id);
      if (k) k.input = { throttle: axisIn(msg.throttle), steer: axisIn(msg.steer) };
    },
    start(room) {
      time = 0;
      order = [];
      grid(room);
    },

    update(dt, room) {
      time += dt;
      for (const [id, k] of karts) {
        const inp = k.finished !== null ? { throttle: 0, steer: 0 } : k.input;
        const loc = locate(k.x, k.z);
        const onGrass = loc.d > HALF_WIDTH;
        const top = onGrass ? GRASS_SPEED : MAX_SPEED;

        if (inp.throttle > 0) k.v += ACCEL * inp.throttle * dt;
        else if (inp.throttle < 0) k.v += (k.v > 0 ? BRAKE : ACCEL * 0.6) * inp.throttle * dt;
        else k.v -= Math.sign(k.v) * Math.min(Math.abs(k.v), 6 * dt); // rolling drag
        if (k.v > top) k.v = Math.max(top, k.v - 30 * dt); // grass slows you down hard
        k.v = clamp(k.v, -REVERSE_MAX, MAX_SPEED);

        const grip = clamp(Math.abs(k.v) / 6, 0, 1);
        k.h += -inp.steer * 2.4 * grip * Math.sign(k.v) * dt;
        k.x += Math.sin(k.h) * k.v * dt;
        k.z += Math.cos(k.h) * k.v * dt;

        // Outer barrier: never more than 4 m off the tarmac.
        const after = locate(k.x, k.z);
        if (after.d > HALF_WIDTH + 4) {
          const s = (HALF_WIDTH + 4) / after.d;
          k.x = after.cx + (k.x - after.cx) * s;
          k.z = after.cz + (k.z - after.cz) * s;
          k.v *= 0.5;
        }

        // Laps: crossing segment 0 forwards counts once the halfway checkpoint was passed.
        if (after.i >= SEGMENTS / 2 - 4 && after.i <= SEGMENTS / 2 + 4) k.half = true;
        if (k.seg > SEGMENTS - 8 && after.i < 8 && k.half) {
          k.lap++;
          k.half = false;
          const p = room.players.get(id);
          if (p) p.score = k.lap;
          if (k.lap >= LAPS && k.finished === null) {
            k.finished = Math.round(time * 100) / 100;
            order.push({ id, time: k.finished });
          }
        }
        k.seg = after.i;
        k.progress = k.lap * SEGMENTS + after.i + after.f;
      }

      // Kart-to-kart bumps.
      const list = [...karts.values()];
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const d = Math.hypot(dx, dz);
          if (d > 0 && d < KART_RADIUS * 2) {
            const push = (KART_RADIUS * 2 - d) / 2;
            a.x -= (dx / d) * push;
            a.z -= (dz / d) * push;
            b.x += (dx / d) * push;
            b.z += (dz / d) * push;
            a.v *= 0.9;
            b.v *= 0.9;
          }
        }
    },

    result(room) {
      const humans = room.humans();
      const allDone = humans.length > 0 && humans.every((p) => karts.get(p.id)?.finished !== null);
      const graceOver = order.length > 0 && time - order[0].time > FINISH_GRACE;
      return allDone || graceOver ? this.timeUp(room) : null;
    },
    timeUp(room) {
      const finished = order.map((o) => o.id);
      const rest = [...karts.entries()].filter(([id]) => !finished.includes(id)).sort((a, b) => b[1].progress - a[1].progress).map(([id]) => id);
      const rank = [...finished, ...rest].map((id) => room.players.get(id)).filter(Boolean);
      for (const p of room.players.values()) p.score = karts.get(p.id)?.lap ?? 0;
      const winner = order[0] ? `${room.players.get(order[0].id)?.name} wins in ${order[0].time.toFixed(1)}s` : `${rank[0]?.name} was ahead`;
      return { winner, ranking: rank.map((p) => ({ id: p.id, name: p.name, score: p.score })) };
    },

    snapshot() {
      const places = [...karts.entries()]
        .sort((a, b) => (a[1].finished ?? 1e9) - (b[1].finished ?? 1e9) || (b[1].progress ?? 0) - (a[1].progress ?? 0))
        .map(([id]) => id);
      return {
        k: [...karts].map(([id, k]) => ({ id, x: r2(k.x), z: r2(k.z), h: r2(k.h), v: r2(k.v), lap: k.lap, fin: k.finished, place: places.indexOf(id) + 1 })),
      };
    },
  };
}
