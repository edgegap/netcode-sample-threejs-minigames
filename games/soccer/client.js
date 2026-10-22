import * as THREE from "three";
import { runGame, EntityMap, makeLabel, TEAM_COLORS, smooth, axis, keys } from "../../client/lib/shell.js";

runGame({
  game: "soccer",
  title: "Rocket Soccer",
  tagline: "1v1 or 2v2. Push the ball into the other goal.",
  help: "WASD / arrows move · Space dash",
  teams: true,
  stage: { background: 0x0e1a2b },
  bannerText: (msg) => `Red ${msg.s.goals[0]} - ${msg.s.goals[1]} Blue`,
  bigText: (msg) => (msg.s.lastGoal ? `GOAL! ${msg.s.lastGoal.by}` : ""),

  create({ scene, camera, myId, info, input }) {
    const root = new THREE.Group();
    scene.add(root);
    const W = info.halfX * 2;
    const D = info.halfZ * 2;

    // Striped pitch.
    for (let i = 0; i < 11; i++) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(W / 11, D), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x3f9b46 : 0x46a84d }));
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.x = -info.halfX + (i + 0.5) * (W / 11);
      stripe.receiveShadow = true;
      root.add(stripe);
    }
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mid = new THREE.Mesh(new THREE.PlaneGeometry(0.2, D), lineMat);
    mid.rotation.x = -Math.PI / 2;
    mid.position.y = 0.01;
    const circle = new THREE.Mesh(new THREE.RingGeometry(4, 4.2, 48), lineMat);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.01;
    root.add(mid, circle);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xcfd8ea, transparent: true, opacity: 0.35 });
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(W, 1.2, 0.3), wallMat);
      side.position.set(0, 0.6, s * (info.halfZ + 0.15));
      root.add(side);
      for (const z of [-1, 1]) {
        const len = info.halfZ - info.goalHalf;
        const end = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, len), wallMat);
        end.position.set(s * (info.halfX + 0.15), 0.6, z * (info.goalHalf + len / 2));
        root.add(end);
      }
      // Goal frame in the colour of the team that defends it (red defends -x).
      const team = s < 0 ? 0 : 1;
      const goalMat = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], emissive: TEAM_COLORS[team], emissiveIntensity: 0.4 });
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, info.goalHalf * 2), goalMat);
      bar.position.set(s * (info.halfX + 0.5), 2.5, 0);
      root.add(bar);
      for (const z of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.5, 0.3), goalMat);
        post.position.set(s * (info.halfX + 0.5), 1.25, z * info.goalHalf);
        root.add(post);
      }
      const net = new THREE.Mesh(new THREE.PlaneGeometry(info.goalHalf * 2, 2.5), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
      net.rotation.y = Math.PI / 2;
      net.position.set(s * (info.halfX + 2), 1.25, 0);
      root.add(net);
    }

    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(info.ballR, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }));
    ball.castShadow = true;
    ball.position.y = info.ballR;
    root.add(ball);

    const players = new Map(); // id -> player row (team, name)
    const bodies = new EntityMap(root, (e) => {
      const p = players.get(e.id) ?? {};
      const g = new THREE.Group();
      const color = TEAM_COLORS[p.team ?? 0];
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24), new THREE.MeshStandardMaterial({ color }));
      body.position.y = 0.5;
      body.castShadow = true;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      dome.position.y = 1;
      g.add(body, dome);
      if (e.id === myId) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.45, 32), new THREE.MeshBasicMaterial({ color: 0xffff66 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.02;
        g.add(ring);
      }
      const label = makeLabel(p.name ?? "");
      label.position.y = 2.4;
      g.add(label);
      g.userData.body = body;
      return g;
    });

    camera.position.set(0, 30, 24);
    camera.lookAt(0, 0, 2);
    let latest = null;
    return {
      state(msg) {
        latest = msg;
        for (const p of msg.players) players.set(p.id, p);
      },
      frame(dt) {
        if (!latest) return;
        const t = smooth(dt, 16);
        bodies.sync(latest.s.p, (g, e, fresh) => {
          if (fresh) g.position.set(e.x, 0, e.z);
          g.position.x += (e.x - g.position.x) * t;
          g.position.z += (e.z - g.position.z) * t;
          g.userData.body.material.emissive.setHex(e.dash ? 0xffffff : 0x000000);
          g.userData.body.material.emissiveIntensity = e.dash ? 0.5 : 0;
        });
        const b = latest.s.ball;
        const ox = ball.position.x;
        const oz = ball.position.z;
        if (Math.hypot(b.x - ox, b.z - oz) > 6) ball.position.set(b.x, info.ballR, b.z); // kickoff: snap
        else {
          ball.position.x += (b.x - ox) * t;
          ball.position.z += (b.z - oz) * t;
        }
        ball.rotation.x += (ball.position.z - oz) / info.ballR;
        ball.rotation.z -= (ball.position.x - ox) / info.ballR;
        camera.position.x += (ball.position.x * 0.35 - camera.position.x) * smooth(dt, 2);
        camera.lookAt(camera.position.x, 0, 2);

        input({
          mx: axis(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]),
          mz: axis(["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]),
          dash: keys.has("Space") || keys.has("ShiftLeft"),
        });
      },
      dispose() {
        scene.remove(root);
      },
    };
  },
});
