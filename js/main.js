import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// V0.1: one textured sphere, nothing else. No terrain, no cities, no 2D
// map yet -- see CLAUDE.md for the planned version sequence. The only
// per-world data point right now is which texture to load, so a second
// world (later) just needs its own config.json pointing at its own image.
const WORLD_CONFIG_URL = "./worlds/kasoku-sekai/config.json";

async function main() {
  const world = await (await fetch(WORLD_CONFIG_URL)).json();

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 0, 3);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById("app").appendChild(renderer.domElement);

  // MeshBasicMaterial (unlit): no lighting setup needed for a first
  // version, and it keeps the whole globe evenly lit instead of half of
  // it going dark for lack of a light source.
  const texture = await new THREE.TextureLoader().loadAsync(world.globeTexture);
  texture.colorSpace = THREE.SRGBColorSpace;

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 32),
    new THREE.MeshBasicMaterial({ map: texture })
  );
  scene.add(globe);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = 1.3;
  controls.maxDistance = 8;
  controls.rotateSpeed = 0.5;

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  document.getElementById("loading").classList.add("hidden");

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  console.error("Failed to start globe:", err);
  const loading = document.getElementById("loading");
  if (loading) {
    loading.textContent = "地球儀の読み込みに失敗しました。通信状況を確認してください。";
  }
});
