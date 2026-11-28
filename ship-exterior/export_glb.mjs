// GLB 書き出し(node 用)。FileReader を Blob.arrayBuffer で代用する
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { writeFileSync } from 'node:fs';
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend && this.onloadend(); this.onload && this.onload({ target: this }); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(b).toString('base64'); this.onloadend && this.onloadend(); }); }
};
const { buildShip } = await import('./ship.js');
for (const mode of ['cruise', 'open', 'decel']) {
  const t0 = Date.now();
  const ship = buildShip(mode);
  let verts = 0; ship.traverse((o) => { if (o.isMesh) verts += o.geometry.attributes.position.count; });
  const scene = new THREE.Scene(); scene.add(ship);
  const glb = await new Promise((res, rej) => new GLTFExporter().parse(scene, res, rej, { binary: true }));
  writeFileSync(`ship_${mode}.glb`, Buffer.from(glb));
  console.log(mode, 'verts', verts, 'length_km', ship.userData.lengthKm.toFixed(1), 'thrusters', ship.userData.thrusterCount, 'MB', (glb.byteLength / 1e6).toFixed(2), (Date.now() - t0) + 'ms');
}
