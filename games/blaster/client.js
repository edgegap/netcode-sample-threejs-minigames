import * as THREE from "three";
import { runGame, EntityMap, makeLabel, colorOf, smooth, lerpAngle, axis, keys } from "../../client/lib/shell.js";

runGame({
  game: "blaster",
  title: "Blaster Arena",
  tagline: "Top-down free-for-all shooter. First to 10 kills.",
  help: "WASD move · mouse aim · hold click (or Space) to fire",
  stage: { background: 0x141a28 },
  bigText: (msg, myId) => (msg.s.p.find((p) => p.id === myId)?.alive === false ? "Respawning..." : ""),

  create({ scene, camera, renderer, myId, info, input }) {
    const root = new THREE.Group();
    scene.add(root);

    const size = info.half * 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: 0x2a3247 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    root.add(floor);
    const grid = new THREE.GridHelper(size, 20, 0x3d4866, 0x3d4866);
    grid.position.y = 0.01;
    root.add(grid);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x55607d });
    for (const [x, z, w, d] of [[0, -info.half, size, 0.5], [0, info.half, size, 0.5], [-info.half, 0, 0.5, size], [info.half, 0, 0.5, size]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), wallMat);
      wall.position.set(x, 0.5, z);
      root.add(wall);
    }
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x7a86a8 });
    for (const b of info.obstacles) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(b.w, 1.6, b.d), boxMat);
      box.position.set(b.x, 0.8, b.z);
      box.castShadow = box.receiveShadow = true;
      root.add(box);
    }

    const names = new Map();
    const players = new EntityMap(root, (e) => {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: colorOf(e.id) });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 0.6, 4, 12), mat);
      body.position.y = 0.8;
      body.castShadow = true;
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.9), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      gun.position.set(0.35, 0.9, 0.5);
      const label = makeLabel(names.get(e.id) ?? "");
      label.position.y = 2.2;
      const hp = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.12), new THREE.MeshBasicMaterial({ color: 0x5ad17a }));
      hp.position.y = 1.85;
      g.add(body, gun, label, hp);
      g.userData = { hp, label };
      return g;
    });
    const bullets = new EntityMap(root, () => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfff1a8 }));
      m.position.y = 0.9;
      return m;
    });

    // Aim: where the mouse ray hits the ground plane.
    const mouse = new THREE.Vector2();
    const ray = new THREE.Raycaster();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.9);
    const hit = new THREE.Vector3();
    let firing = false;
    const onMove = (e) => mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    const onDown = () => (firing = true);
    const onUp = () => (firing = false);
    addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    addEventListener("pointerup", onUp);

    let latest = null;
    const camTarget = new THREE.Vector3();

    return {
      state(msg) {
        latest = msg;
        for (const p of msg.players) names.set(p.id, p.name);
      },
      frame(dt) {
        if (!latest) return;
        const t = smooth(dt);
        players.sync(latest.s.p, (g, e, fresh) => {
          if (fresh) g.position.set(e.x, 0, e.z);
          g.position.x += (e.x - g.position.x) * t;
          g.position.z += (e.z - g.position.z) * t;
          if (e.id !== myId) g.rotation.y = lerpAngle(g.rotation.y, e.a, t);
          g.visible = e.alive;
          g.userData.hp.scale.x = Math.max(0.01, e.hp / 100);
          g.userData.hp.quaternion.copy(camera.quaternion);
        });
        bullets.sync(latest.s.b, (m, e, fresh) => {
          if (fresh) m.position.set(e.x, 0.9, e.z);
          m.position.x += (e.x - m.position.x) * smooth(dt, 25);
          m.position.z += (e.z - m.position.z) * smooth(dt, 25);
        });

        const me = players.get(myId);
        if (me) {
          camTarget.set(me.position.x, 0, me.position.z);
          camera.position.lerp(new THREE.Vector3(camTarget.x, 24, camTarget.z + 15), t);
          camera.lookAt(camTarget);
          ray.setFromCamera(mouse, camera);
          let aim = me.rotation.y;
          if (ray.ray.intersectPlane(ground, hit)) aim = Math.atan2(hit.x - me.position.x, hit.z - me.position.z);
          me.rotation.y = aim; // show our own aim instantly
          input({
            mx: axis(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]),
            mz: axis(["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]),
            aim: Math.round(aim * 100) / 100,
            fire: firing || keys.has("Space"),
          });
        }
      },
      dispose() {
        scene.remove(root);
        removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerdown", onDown);
        removeEventListener("pointerup", onUp);
      },
    };
  },
});
