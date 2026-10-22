// Blaster Arena: top-down free-for-all shooter. First to KILLS_TO_WIN, or most kills when time runs out.
// The server owns movement, bullets, hits and respawns; clients only send move/aim/fire.

import { angleIn, axisIn, clamp, dist2, ffaResult, pointInBox, pushOutOfBox, r2, rand } from "../../server/util.js";

const HALF = 20; // arena is 40 x 40
const SPEED = 8;
const RADIUS = 0.6;
const BULLET_SPEED = 30;
const BULLET_LIFE = 1.1;
const FIRE_COOLDOWN = 0.22;
const DAMAGE = 25;
const RESPAWN = 2;
const KILLS_TO_WIN = 10;

const OBSTACLES = [
  { x: 0, z: 0, w: 4, d: 4 },
  { x: -10, z: -8, w: 6, d: 1.5 },
  { x: 10, z: 8, w: 6, d: 1.5 },
  { x: -9, z: 9, w: 1.5, d: 6 },
  { x: 9, z: -9, w: 1.5, d: 6 },
  { x: 0, z: -14, w: 3, d: 3 },
  { x: 0, z: 14, w: 3, d: 3 },
  { x: -15, z: 0, w: 2, d: 5 },
  { x: 15, z: 0, w: 2, d: 5 },
];

export function createGame() {
  const bodies = new Map(); // player id -> { x, z, a, hp, alive, respawnAt, cooldown, input }
  let bullets = [];
  let bulletId = 1;
  let time = 0;

  const spawnPoint = () => {
    for (;;) {
      const p = { x: rand(-HALF + 2, HALF - 2), z: rand(-HALF + 2, HALF - 2) };
      if (!OBSTACLES.some((b) => pointInBox(p.x, p.z, { ...b, w: b.w + 3, d: b.d + 3 }))) return p;
    }
  };
  const spawn = (body) => Object.assign(body, spawnPoint(), { hp: 100, alive: true, cooldown: 0.5 });

  function botThink(p, body, room) {
    let target = null;
    let best = Infinity;
    for (const [id, other] of bodies) {
      if (id === p.id || !other.alive) continue;
      const d = dist2(body, other);
      if (d < best) [best, target] = [d, other];
    }
    if (!target) return { mx: 0, mz: 0, aim: body.a, fire: false };
    const dx = target.x - body.x;
    const dz = target.z - body.z;
    const d = Math.sqrt(best) || 1;
    // Close in to ~9 m, then strafe around the target.
    const strafe = Math.sin(time * 0.9 + p.id) > 0 ? 1 : -1;
    const toward = d > 9 ? 1 : d < 5 ? -1 : 0;
    return {
      mx: (dx / d) * toward + (-dz / d) * strafe * 0.7,
      mz: (dz / d) * toward + (dx / d) * strafe * 0.7,
      aim: Math.atan2(dx, dz) + rand(-0.12, 0.12),
      fire: d < 16,
    };
  }

  return {
    name: "blaster",
    config: { tickHz: 30, sendHz: 20, maxPlayers: 8, botFill: 3, matchSeconds: 150 },
    info: () => ({ half: HALF, obstacles: OBSTACLES, killsToWin: KILLS_TO_WIN }),

    addPlayer(p) {
      bodies.set(p.id, spawn({ a: 0, input: { mx: 0, mz: 0, aim: 0, fire: false } }));
    },
    removePlayer(p) {
      bodies.delete(p.id);
    },
    input(p, msg) {
      const body = bodies.get(p.id);
      if (body) body.input = { mx: axisIn(msg.mx), mz: axisIn(msg.mz), aim: angleIn(msg.aim), fire: !!msg.fire };
    },
    start(room) {
      bullets = [];
      time = 0;
      for (const body of bodies.values()) spawn(body);
    },
    reset() {
      bullets = [];
    },

    update(dt, room) {
      time += dt;
      for (const p of room.players.values()) {
        const body = bodies.get(p.id);
        if (!body.alive) {
          if (time >= body.respawnAt) spawn(body);
          continue;
        }
        const inp = p.bot ? botThink(p, body, room) : body.input;
        const len = Math.hypot(inp.mx, inp.mz);
        const k = len > 1 ? 1 / len : 1;
        body.x = clamp(body.x + inp.mx * k * SPEED * dt, -HALF + RADIUS, HALF - RADIUS);
        body.z = clamp(body.z + inp.mz * k * SPEED * dt, -HALF + RADIUS, HALF - RADIUS);
        for (const b of OBSTACLES) pushOutOfBox(body, RADIUS, b);
        body.a = inp.aim;
        body.cooldown -= dt;
        if (inp.fire && body.cooldown <= 0) {
          body.cooldown = FIRE_COOLDOWN;
          const sx = Math.sin(body.a);
          const sz = Math.cos(body.a);
          bullets.push({ id: bulletId++, owner: p.id, x: body.x + sx, z: body.z + sz, vx: sx * BULLET_SPEED, vz: sz * BULLET_SPEED, life: BULLET_LIFE });
        }
      }

      for (const bl of bullets) {
        // Two sub-steps so fast bullets don't skip through players.
        for (let s = 0; s < 2 && bl.life > 0; s++) {
          bl.x += (bl.vx * dt) / 2;
          bl.z += (bl.vz * dt) / 2;
          if (Math.abs(bl.x) > HALF || Math.abs(bl.z) > HALF || OBSTACLES.some((b) => pointInBox(bl.x, bl.z, b))) bl.life = 0;
          for (const [id, body] of bodies) {
            if (id === bl.owner || !body.alive || bl.life <= 0) continue;
            if (dist2(bl, body) < (RADIUS + 0.15) ** 2) {
              bl.life = 0;
              body.hp -= DAMAGE;
              if (body.hp <= 0) {
                body.alive = false;
                body.respawnAt = time + RESPAWN;
                const killer = room.players.get(bl.owner);
                if (killer) killer.score++;
              }
            }
          }
        }
        bl.life -= dt;
      }
      bullets = bullets.filter((b) => b.life > 0);
    },

    result(room) {
      const top = [...room.players.values()].find((p) => p.score >= KILLS_TO_WIN);
      return top ? ffaResult(room) : null;
    },
    timeUp: (room) => ffaResult(room),

    snapshot(room) {
      return {
        p: [...bodies].map(([id, b]) => ({ id, x: r2(b.x), z: r2(b.z), a: r2(b.a), hp: b.hp, alive: b.alive })),
        b: bullets.map((b) => ({ id: b.id, x: r2(b.x), z: r2(b.z) })),
      };
    },
  };
}
