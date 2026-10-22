import * as THREE from "three";
import { runGame, colorOf, smooth, keys } from "../../client/lib/shell.js";

const KEY_DIRS = { KeyW: 0, ArrowUp: 0, KeyD: 1, ArrowRight: 1, KeyS: 2, ArrowDown: 2, KeyA: 3, ArrowLeft: 3 };
let roundsToWin = 3;

runGame({
  game: "cycles",
  title: "Light Cycles",
  tagline: "Leave a wall of light. Last one riding wins the round.",
  help: "WASD / arrows turn · first to 3 rounds",
  stage: { background: 0x05060d, fog: [50, 120] },
  scoreText: (p) => `${p.score}/${roundsToWin}`,
  bannerText: (msg) => `Round ${msg.s.round}`,
  bigText: (msg, myId) => {
    if (msg.s.roundWinner) return `${msg.s.roundWinner} takes round ${msg.s.round}`;
    const me = msg.s.c.find((c) => c.id === myId);
    return me && !me.alive ? "Crashed! Spectating..." : "";
  },

  create({ scene, camera, myId, info, input }) {
    roundsToWin = info.roundsToWin;
    const S = info.size;
    const root = new THREE.Group();
    scene.add(root);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ color: 0x0b1020, roughness: 0.4 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(S / 2 - 0.5, 0, S / 2 - 0.5);
    root.add(floor);
    const grid = new THREE.GridHelper(S, S / 2, 0x1d3a6b, 0x14264a);
    grid.position.set(S / 2 - 0.5, 0.01, S / 2 - 0.5);
    root.add(grid);
    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(S, 1.2, S)),
      new THREE.LineBasicMaterial({ color: 0x66ccff })
    );
    border.position.set(S / 2 - 0.5, 0.6, S / 2 - 0.5);
    root.add(border);

    // One trail mesh per cycle, rebuilt from the corner list when it changes.
    const trails = new Map(); // id -> { mesh, head, key }
    const WALL_H = 1.2;
    function wallGeometry(points) {
      const pos = [];
      for (let i = 0; i < points.length - 1; i++) {
        const [x1, z1] = points[i];
        const [x2, z2] = points[i + 1];
        pos.push(x1, 0, z1, x2, 0, z2, x2, WALL_H, z2, x1, 0, z1, x2, WALL_H, z2, x1, WALL_H, z1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      return g;
    }

    let latest = null;
    let myDir = null;
    let lastRound = 0;
    const onKey = (e) => {
      if (e.code in KEY_DIRS) {
        myDir = KEY_DIRS[e.code];
        input({ dir: myDir });
        e.preventDefault();
      }
    };
    addEventListener("keydown", onKey);
    const camPos = new THREE.Vector3(S / 2, 60, S + 20);
    const camLook = new THREE.Vector3(S / 2, 0, S / 2);

    return {
      state(msg) {
        latest = msg;
        if (msg.s.round !== lastRound) {
          lastRound = msg.s.round;
          myDir = null;
        }
        const seen = new Set();
        for (const c of msg.s.c) {
          seen.add(c.id);
          let tr = trails.get(c.id);
          if (!tr) {
            const color = colorOf(c.id);
            const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
            const head = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 }));
            const light = new THREE.PointLight(color, 6, 10);
            light.position.y = 1;
            head.add(light);
            root.add(mesh, head);
            tr = { mesh, head, key: "" };
            trails.set(c.id, tr);
          }
          const key = JSON.stringify(c.t);
          if (key !== tr.key) {
            tr.key = key;
            tr.mesh.geometry.dispose();
            tr.mesh.geometry = wallGeometry(c.t);
          }
          tr.target = c.t.at(-1);
          tr.head.visible = c.alive;
          tr.mesh.material.opacity = c.alive ? 0.8 : 0.3;
        }
        for (const [id, tr] of trails) if (!seen.has(id)) (root.remove(tr.mesh, tr.head), trails.delete(id));
      },
      frame(dt) {
        if (!latest) return;
        for (const tr of trails.values()) {
          if (!tr.target) continue;
          const [x, z] = tr.target;
          if (tr.head.position.distanceTo(new THREE.Vector3(x, 0.4, z)) > 3) tr.head.position.set(x, 0.4, z);
          else tr.head.position.lerp(new THREE.Vector3(x, 0.4, z), smooth(dt, 20));
        }
        // Follow our own cycle while alive, else watch the whole grid.
        const me = trails.get(myId);
        const mine = latest.s.c.find((c) => c.id === myId);
        if (me && mine?.alive) {
          camPos.set(me.head.position.x, 34, me.head.position.z + 26);
          camLook.copy(me.head.position);
        } else {
          camPos.set(S / 2, 70, S + 22);
          camLook.set(S / 2, 0, S / 2 + 4);
        }
        camera.position.lerp(camPos, smooth(dt, 3));
        camera.lookAt(camLook);
        if (myDir !== null) input({ dir: myDir });
      },
      dispose() {
        removeEventListener("keydown", onKey);
        scene.remove(root);
      },
    };
  },
});
