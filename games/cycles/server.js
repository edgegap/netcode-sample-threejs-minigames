// Light Cycles: grid arcade survival. Every cycle leaves a wall; hit any wall and you're out.
// Last one riding wins the round, first to ROUNDS_TO_WIN round wins takes the match.
// The grid steps at STEP_HZ, independent of the room tick; trails go out as corner points.

import { ffaResult } from "../../server/util.js";

const SIZE = 48; // cells per side, cell = 1 m, coordinates 0..SIZE-1
const STEP_HZ = 16;
const ROUNDS_TO_WIN = 3;
const ROUND_PAUSE = 2.5;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up, right, down, left (x, z)

export function createGame() {
  const cycles = new Map(); // id -> { x, z, dir, next, alive, trail: [[x,z]...] }
  let grid = new Int16Array(SIZE * SIZE); // 0 = free, else player id
  let acc = 0;
  let round = 0;
  let pause = 0;
  let roundWinner = null;

  const free = (x, z) => x >= 0 && z >= 0 && x < SIZE && z < SIZE && grid[z * SIZE + x] === 0;

  function newRound(room) {
    grid = new Int16Array(SIZE * SIZE);
    acc = 0;
    round++;
    const list = [...cycles.entries()];
    list.forEach(([id, c], i) => {
      // Spread starts on a circle, everyone heading clockwise.
      const a = (i / list.length) * Math.PI * 2;
      const x = Math.round(SIZE / 2 + Math.cos(a) * SIZE * 0.32);
      const z = Math.round(SIZE / 2 + Math.sin(a) * SIZE * 0.32);
      const tx = -Math.sin(a);
      const tz = Math.cos(a);
      const dir = [0, 1, 2, 3].sort((d1, d2) => DIRS[d2][0] * tx + DIRS[d2][1] * tz - (DIRS[d1][0] * tx + DIRS[d1][1] * tz))[0];
      Object.assign(c, { x, z, dir, next: dir, alive: true, trail: [[x, z]] });
      grid[z * SIZE + x] = id;
    });
  }

  // Bot: keep going if the next few cells are free, otherwise take the side with more room.
  function botTurn(id, c) {
    const run = (dir) => {
      let n = 0;
      let [x, z] = [c.x, c.z];
      while (n < 8) {
        x += DIRS[dir][0];
        z += DIRS[dir][1];
        if (!free(x, z)) break;
        n++;
      }
      return n;
    };
    const options = [c.dir, (c.dir + 1) % 4, (c.dir + 3) % 4].map((d) => ({ d, n: run(d) + Math.random() * 2 }));
    if (options[0].n > 3 && Math.random() > 0.06) return c.dir;
    return options.sort((a, b) => b.n - a.n)[0].d;
  }

  function step(room) {
    const moves = [];
    for (const [id, c] of cycles) {
      if (!c.alive) continue;
      const p = room.players.get(id);
      const want = p?.bot ? botTurn(id, c) : c.next;
      if (want !== (c.dir + 2) % 4 && want !== c.dir) {
        c.dir = want;
        c.trail.push([c.x, c.z]); // corner
      }
      moves.push([id, c, c.x + DIRS[c.dir][0], c.z + DIRS[c.dir][1]]);
    }
    // Head-on: two cycles entering the same cell both crash.
    const targets = new Map();
    for (const [, , x, z] of moves) targets.set(`${x},${z}`, (targets.get(`${x},${z}`) ?? 0) + 1);
    for (const [id, c, x, z] of moves) {
      if (!free(x, z) || targets.get(`${x},${z}`) > 1) {
        c.alive = false;
        continue;
      }
      c.x = x;
      c.z = z;
      grid[z * SIZE + x] = id;
    }
  }

  return {
    name: "cycles",
    config: { tickHz: 30, sendHz: 20, maxPlayers: 6, botFill: 4, matchSeconds: 180 },
    info: () => ({ size: SIZE, roundsToWin: ROUNDS_TO_WIN, stepHz: STEP_HZ }),

    addPlayer(p) {
      // Joins mid-round sit out until the next round.
      cycles.set(p.id, { x: -10, z: -10, dir: 0, next: 0, alive: false, trail: [] });
    },
    removePlayer(p) {
      const c = cycles.get(p.id);
      if (c) c.alive = false;
      cycles.delete(p.id);
    },
    input(p, msg) {
      const c = cycles.get(p.id);
      if (c && Number.isInteger(msg.dir) && msg.dir >= 0 && msg.dir < 4) c.next = msg.dir;
    },
    start(room) {
      round = 0;
      roundWinner = null;
      newRound(room);
    },

    update(dt, room) {
      if (pause > 0) {
        pause -= dt;
        if (pause <= 0) {
          roundWinner = null;
          newRound(room);
        }
        return;
      }
      acc += dt;
      while (acc >= 1 / STEP_HZ) {
        acc -= 1 / STEP_HZ;
        step(room);
      }
      const alive = [...cycles].filter(([, c]) => c.alive);
      // No point making people watch bots: once every human is out, the longest bot trail takes it.
      const humansOut = room.humans().length > 0 && !alive.some(([id]) => !room.players.get(id)?.bot);
      if (alive.length <= 1 || humansOut) {
        alive.sort((a, b) => b[1].trail.length - a[1].trail.length);
        const winner = alive[0] && room.players.get(alive[0][0]);
        if (winner) winner.score++;
        roundWinner = winner ? winner.name : "Nobody";
        pause = ROUND_PAUSE;
      }
    },

    result(room) {
      if (pause > 0 && pause < 1.5) {
        const champ = [...room.players.values()].find((p) => p.score >= ROUNDS_TO_WIN);
        if (champ) return ffaResult(room, ` ${champ.score} rounds`);
      }
      return null;
    },
    timeUp: (room) => ffaResult(room),

    snapshot() {
      return {
        round,
        roundWinner,
        c: [...cycles].map(([id, c]) => ({ id, alive: c.alive, dir: c.dir, t: [...c.trail, [c.x, c.z]] })),
      };
    },
  };
}
