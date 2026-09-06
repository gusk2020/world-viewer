import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  directionToLngLat,
  lngLatToDirection,
  distanceToZoom,
  zoomToDistance,
} from "./geoConvert.js";

const MIN_DISTANCE = 1.3;
const MAX_DISTANCE = 8;

// The 3D globe (V0.1), now wrapped as a self-contained module so V0.3 can
// mount it alongside the 2D map and read/set its current view for the
// toggle button -- see getView()/setView() below and js/geoConvert.js for
// the lng/lat and zoom conversion this relies on.
export async function initGlobe3D(containerId, textureUrl) {
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
  document.getElementById(containerId).appendChild(renderer.domElement);

  // MeshBasicMaterial (unlit): no lighting setup needed for a first
  // version, and it keeps the whole globe evenly lit instead of half of
  // it going dark for lack of a light source.
  const texture = await new THREE.TextureLoader().loadAsync(textureUrl);
  texture.colorSpace = THREE.SRGBColorSpace;

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 32),
    new THREE.MeshBasicMaterial({ map: texture })
  );
  scene.add(globe);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.rotateSpeed = 0.5;

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  function getView() {
    const direction = camera.position.clone().normalize();
    const { lng, lat } = directionToLngLat(direction.x, direction.y, direction.z);
    return { lng, lat, zoom: distanceToZoom(camera.position.length()) };
  }

  function setView({ lng, lat, zoom }) {
    const distance = zoomToDistance(zoom, MIN_DISTANCE, MAX_DISTANCE);
    const direction = lngLatToDirection(lng, lat);
    camera.position.set(direction.x * distance, direction.y * distance, direction.z * distance);
    controls.update();
  }

  return { getView, setView };
}
