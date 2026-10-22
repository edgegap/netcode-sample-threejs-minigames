import * as THREE from "three";
import { runGame, EntityMap, makeLabel, colorOf, smooth, axis, keys } from "../../client/lib/shell.js";

let roundsToWin = 3;

runGame({
  game: "sumo",
  title: "Sumo Push",
  tagline: "Party brawler. Shove everyone off the shrinking ring.",
  help: "WASD / arrows move · Space dash (heavy hit) · first to 3 rounds",
  stage: { background: 0x1b1030, fog: [40, 110] },
  scoreText: (p) => `${p.score}/${roundsToWin}`,
  bannerText: (msg) => `Round ${msg.s.round}`,
  bigText: (msg, myId) => {
    if (msg.s.roundWinner) return `${msg.s.roundWinner} wins round ${msg.s.round}`;
    return msg.s.p.find((p) => p.id === myId)?.out ? "Out! Waiting for the next round" : "";
  },

  create({ scene, camera, myId, info, input }) {
    roundsToWin = info.roundsToWin;
    const root = new THREE.Group();
    scene.add(root);

    // The ring is a unit cylinder scaled to the server's current radius.
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 64), new THREE.MeshStandardMaterial({ color: 0xe8d5a8 }));
    ring.position.y = -0.5;
    ring.receiveShadow = true;
    const edge = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 8, 96), new THREE.MeshBasicMaterial({ color: 0xff4d4d }));
    edge.rotation.x = Math.PI / 2;
    const ringGroup = new THREE.Group();
    ringGroup.add(ring, edge);
    root.add(ringGroup);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(info.ringStart + 1, info.ringStart + 3, 3, 64), new THREE.MeshStandardMaterial({ color: 0x3a2a55 }));
    base.position.y = -2.6;
    root.add(base);

    const names = new Map();
    const bodies = new EntityMap(root, (e) => {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), new THREE.MeshStandardMaterial({ color: colorOf(e.id), roughness: 0.35 }));
      ball.position.y = 1;
      ball.castShadow = true;
      const eyes = new THREE.Group();
      for (const x of [-0.35, 0.35]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        eye.position.set(x, 1.3, 0.85);
        const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0x000000 }));
        pupil.position.set(x, 1.3, 1.0);
        eyes.add(eye, pupil);
      }
      const label = makeLabel(names.get(e.id) ?? "");
      label.position.y = 2.8;
      g.add(ball, eyes, label);
      g.userData.ball = ball;
      return g;
    });

    camera.position.set(0, 26, 22);
    camera.lookAt(0, 0, 0);
    let latest = null;
    return {
      state(msg) {
        latest = msg;
        for (const p of msg.players) names.set(p.id, p.name);
      },
      frame(dt) {
        if (!latest) return;
        const t = smooth(dt, 16);
        const r = latest.s.ring;
        ringGroup.scale.x += (r - ringGroup.scale.x) * t;
        ringGroup.scale.z = ringGroup.scale.x;
        bodies.sync(latest.s.p, (g, e, fresh) => {
          const jump = Math.hypot(e.x - g.position.x, e.z - g.position.z) > 5;
          if (fresh || jump) g.position.set(e.x, e.y, e.z);
          const dx = e.x - g.position.x;
          const dz = e.z - g.position.z;
          g.position.x += dx * t;
          g.position.z += dz * t;
          g.position.y += (e.y - g.position.y) * t;
          if (Math.hypot(dx, dz) > 0.02) g.rotation.y = Math.atan2(dx, dz); // face where we're heading
          g.visible = e.y > -40;
          const s = e.dash ? 1.15 : 1;
          g.userData.ball.scale.setScalar(g.userData.ball.scale.x + (s - g.userData.ball.scale.x) * t);
        });
        input({
          mx: axis(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]),
          mz: axis(["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]),
          dash: keys.has("Space"),
        });
      },
      dispose() {
        scene.remove(root);
      },
    };
  },
});
