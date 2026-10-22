import * as THREE from "three";
import { runGame, EntityMap, makeLabel, colorOf, smooth, lerpAngle, axis } from "../../client/lib/shell.js";

const ordinal = (n) => n + (["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? "th");
let laps = 3;

runGame({
  game: "kart",
  title: "Kart Rally",
  tagline: "Arcade racing. Three laps, grass is slow.",
  help: "W / ↑ accelerate · S / ↓ brake & reverse · A D / ← → steer",
  stage: { background: 0x87b8e8, fog: [60, 160] },
  scoreText: (p, msg) => {
    const k = msg.s.k.find((k) => k.id === p.id);
    return k?.fin != null ? `${k.fin.toFixed(1)}s` : `Lap ${Math.min(laps, (k?.lap ?? 0) + 1)}/${laps}`;
  },
  bigText: (msg, myId) => {
    const k = msg.s.k.find((k) => k.id === myId);
    return k?.fin != null ? `Finished ${ordinal(k.place)}!` : "";
  },
  bannerText: (msg) => {
    const me = msg.s.k.find((k) => k.id === window.__game.myId);
    return me ? `${ordinal(me.place)} of ${msg.s.k.length}` : "";
  },

  create({ scene, camera, myId, info, input }) {
    laps = info.laps;
    window.__game.myId = myId;
    const root = new THREE.Group();
    scene.add(root);

    const grass = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x4f9a48 }));
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    root.add(grass);

    // Track ribbon built from the server's centreline.
    const pts = info.track;
    const n = pts.length;
    const pos = [];
    const curbPos = [];
    const curbCol = [];
    for (let i = 0; i <= n; i++) {
      const a = pts[i % n];
      const b = pts[(i + 1) % n];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const nx = -dz / len;
      const nz = dx / len;
      const w = info.halfWidth;
      pos.push(a.x + nx * w, 0.02, a.z + nz * w, a.x - nx * w, 0.02, a.z - nz * w);
      const red = i % 2 ? [1, 0.2, 0.2] : [1, 1, 1];
      curbPos.push(a.x + nx * (w + 0.6), 0.03, a.z + nz * (w + 0.6), a.x + nx * w, 0.03, a.z + nz * w);
      curbPos.push(a.x - nx * w, 0.03, a.z - nz * w, a.x - nx * (w + 0.6), 0.03, a.z - nz * (w + 0.6));
      curbCol.push(...red, ...red, ...red, ...red);
    }
    const strip = (positions, stride) => {
      const idx = [];
      for (let i = 0; i < n; i++) {
        const a = i * stride;
        const b = (i + 1) * stride;
        for (let s = 0; s < stride; s += 2) idx.push(a + s, a + s + 1, b + s, b + s, a + s + 1, b + s + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const road = new THREE.Mesh(strip(pos, 2), new THREE.MeshStandardMaterial({ color: 0x3a3d45, side: THREE.DoubleSide }));
    road.receiveShadow = true;
    root.add(road);
    const curbGeo = strip(curbPos, 4);
    curbGeo.setAttribute("color", new THREE.Float32BufferAttribute(curbCol, 3));
    root.add(new THREE.Mesh(curbGeo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide })));

    // Chequered start/finish line across segment 0.
    const tex = (() => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 16;
      const g = c.getContext("2d");
      for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
        g.fillStyle = (x + y) % 2 ? "#111" : "#fff";
        g.fillRect(x * 8, y * 8, 8, 8);
      }
      const t = new THREE.CanvasTexture(c);
      t.magFilter = THREE.NearestFilter;
      return t;
    })();
    const line = new THREE.Mesh(new THREE.PlaneGeometry(info.halfWidth * 2, 1.5), new THREE.MeshBasicMaterial({ map: tex }));
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = Math.atan2(pts[1].x - pts[0].x, pts[1].z - pts[0].z); // across the track
    line.position.set(pts[0].x, 0.05, pts[0].z);
    root.add(line);

    // A few trees so speed reads well.
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x2f6d33 });
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 52 + Math.random() * 40;
      const tree = new THREE.Mesh(new THREE.ConeGeometry(1.5, 5, 7), treeMat);
      tree.position.set(Math.cos(a) * r, 2.5, Math.sin(a) * r);
      tree.castShadow = true;
      root.add(tree);
    }

    const names = new Map();
    const karts = new EntityMap(root, (e) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 2.4), new THREE.MeshStandardMaterial({ color: colorOf(e.id) }));
      body.position.y = 0.55;
      body.castShadow = true;
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.7), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      seat.position.set(0, 0.9, -0.3);
      g.add(body, seat);
      const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12).rotateZ(Math.PI / 2);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
      for (const [x, z] of [[-0.8, 0.8], [0.8, 0.8], [-0.8, -0.8], [0.8, -0.8]]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(x, 0.35, z);
        g.add(w);
      }
      const label = makeLabel(names.get(e.id) ?? "");
      label.position.y = 2.2;
      g.add(label);
      return g;
    });

    let latest = null;
    const look = new THREE.Vector3();
    return {
      state(msg) {
        latest = msg;
        for (const p of msg.players) names.set(p.id, p.name);
      },
      frame(dt) {
        if (!latest) return;
        const t = smooth(dt, 12);
        karts.sync(latest.s.k, (g, e, fresh) => {
          if (fresh) g.position.set(e.x, 0, e.z);
          g.position.x += (e.x - g.position.x) * t;
          g.position.z += (e.z - g.position.z) * t;
          g.rotation.y = fresh ? e.h : lerpAngle(g.rotation.y, e.h, t);
        });
        const me = karts.get(myId);
        if (me) {
          const h = me.rotation.y;
          const want = new THREE.Vector3(me.position.x - Math.sin(h) * 9, 4.5, me.position.z - Math.cos(h) * 9);
          camera.position.lerp(want, smooth(dt, 5));
          look.set(me.position.x + Math.sin(h) * 4, 1, me.position.z + Math.cos(h) * 4);
          camera.lookAt(look);
        }
        input({
          throttle: axis(["KeyS", "ArrowDown"], ["KeyW", "ArrowUp"]),
          steer: axis(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]),
        });
      },
      dispose() {
        scene.remove(root);
      },
    };
  },
});
