// Rocket Soccer: 1v1 or 2v2 team game. Teams come from the matchmaker (the profile has
// team_count 2, so every ticket carries a team_id); direct and local joins are balanced instead.
// Bots fill empty seats so a team is never empty.

import { axisIn, clamp, r2 } from "../../server/util.js";

const HALF_X = 22; // pitch 44 x 26
const HALF_Z = 13;
const GOAL_HALF = 4.5;
const PLAYER_R = 1;
const BALL_R = 0.8;
const ACCEL = 40;
const MAX_SPEED = 11;
const DASH_SPEED = 22;
const DASH_COOLDOWN = 1.5;
const KICKOFF_PAUSE = 2;

export function createGame() {
  const bodies = new Map(); // id -> { x, z, vx, vz, dash, input }
  const ball = { x: 0, z: 0, vx: 0, vz: 0 };
  const goals = [0, 0];
  let pause = 0;
  let lastGoal = null;

  const teamSizes = (room) => [0, 1].map((t) => [...room.players.values()].filter((p) => p.team === t).length);

  function kickoff(room) {
    Object.assign(ball, { x: 0, z: 0, vx: 0, vz: 0 });
    const slots = [0, 0];
    for (const p of room.players.values()) {
      const b = bodies.get(p.id);
      const k = slots[p.team]++;
      Object.assign(b, { x: (p.team === 0 ? -1 : 1) * (8 + k * 5), z: k % 2 ? 5 : -5 * k, vx: 0, vz: 0, dash: 0 });
    }
    pause = KICKOFF_PAUSE;
  }

  function botInput(p, b) {
    // Get behind the ball relative to the goal we attack, then drive through it.
    const goalX = p.team === 0 ? HALF_X : -HALF_X;
    const dir = Math.sign(goalX);
    const behind = { x: ball.x - dir * 2.2, z: ball.z - (0 - ball.z) * 0.15 };
    const lined = (b.x - ball.x) * dir < -1 && Math.abs(b.z - ball.z) < 2;
    const target = lined ? ball : behind;
    const dx = target.x - b.x;
    const dz = target.z - b.z;
    const d = Math.hypot(dx, dz) || 1;
    return { mx: dx / d, mz: dz / d, dash: lined && d < 4 };
  }

  return {
    name: "soccer",
    config: { tickHz: 60, sendHz: 20, maxPlayers: 4, botFill: 2, matchSeconds: 120 },
    info: () => ({ halfX: HALF_X, halfZ: HALF_Z, goalHalf: GOAL_HALF, ballR: BALL_R }),

    // Even teams: bots fill whichever side is short (at least 1v1).
    botsNeeded(room) {
      const [a, b] = teamSizes(room);
      return Math.max(a, b, 1) * 2 - a - b;
    },

    addPlayer(p, room) {
      // Keep the matchmaker's team if it gave one, else join the smaller team.
      if (p.team !== 0 && p.team !== 1) {
        const [a, b] = teamSizes(room).map((n, t) => n - (p.team === t ? 1 : 0));
        p.team = a <= b ? 0 : 1;
      }
      bodies.set(p.id, { x: 0, z: 0, vx: 0, vz: 0, dash: 0, input: { mx: 0, mz: 0, dash: false } });
      if (room.phase !== "playing") kickoff(room);
    },
    removePlayer(p) {
      bodies.delete(p.id);
    },
    input(p, msg) {
      const b = bodies.get(p.id);
      if (b) b.input = { mx: axisIn(msg.mx), mz: axisIn(msg.mz), dash: !!msg.dash };
    },
    start(room) {
      goals[0] = goals[1] = 0;
      lastGoal = null;
      kickoff(room);
    },

    update(dt, room) {
      if (pause > 0) {
        pause -= dt;
        return;
      }
      for (const p of room.players.values()) {
        const b = bodies.get(p.id);
        const inp = p.bot ? botInput(p, b) : b.input;
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
        const cap = b.dash > DASH_COOLDOWN - 0.25 ? DASH_SPEED : MAX_SPEED;
        if (speed > cap) {
          b.vx *= cap / speed;
          b.vz *= cap / speed;
        }
        b.vx *= Math.exp(-3 * dt);
        b.vz *= Math.exp(-3 * dt);
        b.x = clamp(b.x + b.vx * dt, -HALF_X + PLAYER_R, HALF_X - PLAYER_R);
        b.z = clamp(b.z + b.vz * dt, -HALF_Z + PLAYER_R, HALF_Z - PLAYER_R);

        // Player hits ball: ball takes the player's speed along the contact normal, plus a kick.
        const dx = ball.x - b.x;
        const dz = ball.z - b.z;
        const d = Math.hypot(dx, dz);
        if (d < PLAYER_R + BALL_R && d > 0) {
          const nx = dx / d;
          const nz = dz / d;
          ball.x = b.x + nx * (PLAYER_R + BALL_R);
          ball.z = b.z + nz * (PLAYER_R + BALL_R);
          const rel = (b.vx - ball.vx) * nx + (b.vz - ball.vz) * nz;
          if (rel > 0) {
            ball.vx += nx * rel * 1.6;
            ball.vz += nz * rel * 1.6;
          }
          ball.vx += nx * 2;
          ball.vz += nz * 2;
          ball.lastTouch = p.id;
        }
      }

      // Players bump each other.
      const list = [...bodies.values()];
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const c = list[j];
          const dx = c.x - a.x;
          const dz = c.z - a.z;
          const d = Math.hypot(dx, dz);
          if (d > 0 && d < PLAYER_R * 2) {
            const push = (PLAYER_R * 2 - d) / 2;
            a.x -= (dx / d) * push;
            a.z -= (dz / d) * push;
            c.x += (dx / d) * push;
            c.z += (dz / d) * push;
          }
        }

      // Ball: friction, walls, goals.
      ball.vx *= Math.exp(-0.6 * dt);
      ball.vz *= Math.exp(-0.6 * dt);
      const bs = Math.hypot(ball.vx, ball.vz);
      if (bs > 32) {
        ball.vx *= 32 / bs;
        ball.vz *= 32 / bs;
      }
      ball.x += ball.vx * dt;
      ball.z += ball.vz * dt;
      if (Math.abs(ball.z) > HALF_Z - BALL_R) {
        ball.z = Math.sign(ball.z) * (HALF_Z - BALL_R);
        ball.vz *= -0.8;
      }
      if (Math.abs(ball.x) > HALF_X - BALL_R) {
        if (Math.abs(ball.z) < GOAL_HALF) {
          const scoringTeam = ball.x > 0 ? 0 : 1; // team 0 attacks +x
          goals[scoringTeam]++;
          const scorer = room.players.get(ball.lastTouch);
          if (scorer && scorer.team === scoringTeam) scorer.score++;
          lastGoal = { team: scoringTeam, by: scorer?.name ?? "?", at: Date.now() };
          kickoff(room);
          return;
        }
        ball.x = Math.sign(ball.x) * (HALF_X - BALL_R);
        ball.vx *= -0.8;
      }
    },

    // Golden goal is not worth the complexity: the match ends on time.
    timeUp(room) {
      const [a, b] = goals;
      const winner = a === b ? `Draw ${a} - ${b}` : `${a > b ? "Red" : "Blue"} team wins ${Math.max(a, b)} - ${Math.min(a, b)}`;
      const ranking = [...room.players.values()].sort((x, y) => y.score - x.score).map((p) => ({ id: p.id, name: p.name, score: p.score }));
      return { winner, ranking, goals: [a, b] };
    },

    snapshot() {
      return {
        p: [...bodies].map(([id, b]) => ({ id, x: r2(b.x), z: r2(b.z), dash: b.dash > DASH_COOLDOWN - 0.25 })),
        ball: { x: r2(ball.x), z: r2(ball.z) },
        goals,
        lastGoal: lastGoal && Date.now() - lastGoal.at < 2500 ? lastGoal : null,
      };
    },
  };
}
