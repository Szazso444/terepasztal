/**
 * Runtime 3D preview (route 3). Renders the same asset library the sprite bake uses, live, through
 * an orthographic 2:1 dimetric camera that matches the kit's rig. This proves the thesis of the
 * plan in `docs/art-pipeline.md`: one library of asset programs drives both the baked sprites and
 * a live 3D renderer, so the choice between them stays open.
 *
 * It is a foundation, not a replacement for `src/render`. It is loaded only behind the `#r3d`
 * flag (see `src/main.ts`), through a dynamic import, so the shipped PixiJS bundle never pulls in
 * three.js. Toon shading, outlines, a LUT grade and the tile world are the next steps; this draws
 * the assets correctly lit and correctly projected.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { css, PAL } from '../art/palette';

/** Assets to show, mirroring the bake manifest. Each renders from its own .glb. */
const ASSETS = [{ key: 'structures/station_1', label: 'Station · rendered live from station.py' }];

/** Boot the preview into a full-window canvas; returns a disposer. */
export function bootIsoPreview(mount: HTMLElement): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(css(PAL.grass[1])).multiplyScalar(0.7);

  // 2:1 dimetric: 30° elevation, 45° azimuth, orthographic — the screen match to the kit camera.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const elev = Math.PI / 6; // 30° gives the 2:1 tile ratio
  const azim = Math.PI / 4;
  const dist = 20;
  camera.position.set(
    Math.cos(elev) * Math.sin(azim) * dist,
    Math.sin(elev) * dist,
    Math.cos(elev) * Math.cos(azim) * dist,
  );
  camera.lookAt(0, 0, 0);

  // the kit's light: one warm key from screen upper-left, a cool sky fill so shadows read.
  const key = new THREE.DirectionalLight(new THREE.Color(1.0, 0.96, 0.88), 2.6);
  key.position.set(-2, 6, 6); // from screen upper-left, onto the camera-facing walls
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const c = key.shadow.camera as THREE.OrthographicCamera;
  c.left = -2;
  c.right = 2;
  c.top = 2;
  c.bottom = -2;
  c.near = 0.5;
  c.far = 30;
  scene.add(key);
  const fill = new THREE.HemisphereLight(
    new THREE.Color(css([150, 178, 190])),
    new THREE.Color(css(PAL.grass[2])),
    0.9,
  );
  scene.add(fill);

  // a grass ground so the assets sit in the world, and catch the contact shadow
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(css(PAL.grass[1])), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const label = document.createElement('div');
  label.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;padding:10px 14px;font:13px/1.4 Verdana,sans-serif;' +
    'color:#e4d5b5;background:linear-gradient(transparent,rgba(20,32,26,.75));text-align:center;pointer-events:none';
  label.textContent =
    'Runtime 3D preview — the same asset library that bakes the sprites, drawn live. Loading…';
  mount.appendChild(label);

  const loader = new GLTFLoader();
  let loaded = 0;
  ASSETS.forEach(({ key: assetKey }, i) => {
    const url = `/models/${assetKey.replace('/', '_')}.glb`;
    loader.load(
      url,
      (gltf) => {
        const root = gltf.scene;
        root.position.x = (i - (ASSETS.length - 1) / 2) * 1.6;
        root.rotation.y = Math.PI; // turn the windowed platform face toward the camera
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
            const mat = m.material as THREE.MeshStandardMaterial;
            mat.flatShading = true; // facets read like the kit's flat-shaded sprites
            mat.needsUpdate = true;
          }
        });
        scene.add(root);
        loaded++;
        if (loaded === ASSETS.length)
          label.textContent = ASSETS.map((a) => a.label).join('   ·   ');
      },
      undefined,
      () => {
        label.textContent = `Could not load ${url}. Run \`node tools/export-models.mjs\` to export the models first.`;
      },
    );
  });

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    // frustum shows ~4 tiles wide; the 2:1 look comes from the camera angle, not the frustum
    const view = 4;
    const aspect = w / h;
    camera.left = (-view * aspect) / 2;
    camera.right = (view * aspect) / 2;
    camera.top = view / 2;
    camera.bottom = -view / 2;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  let raf = 0;
  const tick = () => {
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  tick();

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    renderer.dispose();
    renderer.domElement.remove();
    label.remove();
  };
}
