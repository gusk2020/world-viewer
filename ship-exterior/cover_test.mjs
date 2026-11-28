import * as THREE from 'three';
const { buildBudShield } = await import('./ship.js');
for (const open of [1, 0]) {
  const geo = buildBudShield(open, false);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const rmax = Math.max(bb.max.y, -bb.min.y, bb.max.z, -bb.min.z);
  const rc = new THREE.Raycaster();
  const N = 90; let total = 0, miss = 0; const missR = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const y = (i / (N - 1) * 2 - 1) * rmax, z = (j / (N - 1) * 2 - 1) * rmax;
    const r = Math.hypot(y, z);
    if (r > 0.9 * rmax) continue;
    total++;
    rc.set(new THREE.Vector3(bb.max.x + 5, y, z), new THREE.Vector3(-1, 0, 0));
    if (rc.intersectObject(mesh).length === 0) { miss++; missR.push(r.toFixed(2)); }
  }
  console.log(open ? 'open' : 'closed', 'rmax', rmax.toFixed(2), 'ratio_to_hullR', (rmax / 3.8).toFixed(2), 'rays', total, 'gaps', miss, missR.slice(0, 15).join(','));
}
