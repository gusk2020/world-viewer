// 3D view: the habitat cylinder (rotating) with the same unwrapped map as the 2D view painted on its inner face,
// plus the non-rotating bow shield, axis light and stern industry/propulsion bowl as concept layers.
(function () {
  "use strict";
  if (!window.THREE) { window.Ship3D = null; return; }
  const $ = (id) => document.getElementById(id), C = window.ShipCore;
  const host = $("view3d"), labelsEl = $("labels3d");
  let renderer = null, scene, camera, controls, spinGroup, fixedGroup, tex, texCanvas, clip, built = null, running = false, spinMul = 20, hiQ = false, showLayers = true, current = "overview";
  const labels = [];

  function init() {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;
    host.appendChild(renderer.domElement);
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x030914);
    camera = new THREE.PerspectiveCamera(50, 1, 0.002, 2000);
    camera.up.set(0, 1, 0);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.screenSpacePanning = true;
    scene.add(new THREE.AmbientLight(0xbfd8ff, 0.75));
    const sun = new THREE.PointLight(0xfff3d0, 1.3, 0, 1); scene.add(sun); // the axis light, approximately
    spinGroup = new THREE.Group(); fixedGroup = new THREE.Group(); scene.add(spinGroup, fixedGroup);
    clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    window.addEventListener("resize", resize);
    ShipApp.onChange(() => { if (running) rebuildSoon(); });
  }
  function resize() { if (!renderer) return; const w = host.clientWidth || 1, h = host.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }

  // ---------------------------------------------------------------- map texture (shared painter with the 2D view)
  function paintTexture(lay) {
    const f = lay.frame, TW = hiQ ? 2048 : 1024, TH = Math.min(hiQ ? 8192 : 4096, Math.max(256, Math.round((TW * f.h) / f.w)));
    if (!texCanvas) texCanvas = document.createElement("canvas");
    texCanvas.width = TW; texCanvas.height = TH;
    const g = texCanvas.getContext("2d");
    g.fillStyle = ShipDraw.COLORS.sea; g.fillRect(0, 0, TW, TH);
    const sx = TW / f.w, sy = -TH / f.h, left = f.x - f.w / 2, top = f.y + f.h / 2;
    const T = { sx, ox: -left * sx, sy, oy: -top * sy };
    const v = ShipApp.view;
    ShipDraw.paintMap(g, lay, ShipApp.interference, T, { low: left, high: left + f.w, south: f.y - f.h / 2, north: top },
      { borders: v.borders, prefNames: v.prefNames, prefFont: Math.max(9, Math.round(TW / 70)), cities: v.cities, cityNames: v.cities && hiQ, cityFont: Math.round(TW / 90), interference: v.interference, symbols: v.symbols, symbolPx: 3, symbolR: 2, borderPx: TW / 900, edgePx: TW / 1200, minOverlapPx: 2 });
    // the seam is not an edge on the ship: a faint graticule every 90° so the wrap can be checked
    g.strokeStyle = "rgba(255,230,150,0.35)"; g.lineWidth = 1; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo((k * TW) / 4, 0); g.lineTo((k * TW) / 4, TH); g.stroke(); }
    if (!tex) { tex = new THREE.CanvasTexture(texCanvas); tex.wrapS = THREE.RepeatWrapping; }
    tex.image = texCanvas; tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); tex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- geometry
  function disposeGroup(g) { while (g.children.length) { const o = g.children.pop(); o.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material && n.material !== tex) { if (n.material.map && n.material.map !== tex) n.material.map.dispose(); n.material.dispose(); } }); } }
  function cylinder(R, L, seg, mat, open) { const g = new THREE.CylinderGeometry(R, R, L, seg, 1, open !== false); g.rotateX(Math.PI / 2); return new THREE.Mesh(g, mat); }
  function addLabel(obj, text, cls) { const el = document.createElement("div"); el.textContent = text; if (cls) el.style.color = cls; labelsEl.appendChild(el); labels.push({ obj, el }); }
  function anchor(group, x, y, z) { const o = new THREE.Object3D(); o.position.set(x, y, z); group.add(o); return o; }

  function build() {
    const lay = ShipApp.layout, st = ShipApp.state, f = lay.frame, R = st.ship.innerDiameterKm / 2, L = st.ship.cylinderLengthKm;
    disposeGroup(spinGroup); disposeGroup(fixedGroup); labels.length = 0; labelsEl.innerHTML = "";
    paintTexture(lay);
    const clipPlanes = current === "section" ? [clip] : [];
    // Habitat surface: the map lives on the inside face. Cylinder UV u runs around, v along the axis.
    const seg = hiQ ? 256 : 128;
    const geo = new THREE.CylinderGeometry(R, R, L, seg, Math.max(1, Math.round(L / 2)), true);
    geo.rotateX(Math.PI / 2); // axis -> z; CylinderGeometry's v=1 is +y before the turn, i.e. +z (bow) after it
    // Mirror u so the map reads correctly from inside (east to your right when facing the bow). u=0 is the west seam,
    // matching ShipCore.toCylinder; CylinderGeometry's own seam column stays at u=0/1, so nothing tears there.
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    uv.needsUpdate = true;
    const inside = current === "inside";
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, transparent: !inside, opacity: inside ? 1 : 0.9, clippingPlanes: clipPlanes, depthWrite: true }));
    ground.renderOrder = 1; spinGroup.add(ground);
    if (showLayers) {
      // 地下層：生命維持・緊急退避・物質循環（概念）／外殻
      spinGroup.add(cylinder(R * 1.035, L, 96, new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: clipPlanes })));
      spinGroup.add(cylinder(R * 1.07, L, 64, new THREE.MeshBasicMaterial({ color: 0x10b981, wireframe: true, transparent: true, opacity: 0.07, clippingPlanes: clipPlanes })));
      for (const z of [-L / 2, L / 2]) { const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.995, R * 1.07, 96), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })); ring.position.z = z; spinGroup.add(ring); }
      addLabel(anchor(spinGroup, 0, R * 1.07, -L * 0.3), "地下 生命維持・物質循環", "#7ee8d8");
      // 非回転：船首の傘型防御シールド（丸ネジの頭）
      const shield = new THREE.Mesh(new THREE.SphereGeometry(R * 1.9, 48, 12, 0, Math.PI * 2, 0, 0.62), new THREE.MeshLambertMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      shield.rotation.x = Math.PI / 2; shield.position.z = L / 2 + R * 0.25 - R * 1.9 * Math.cos(0.62); fixedGroup.add(shield);
      { const hub = cylinder(R * 0.55, R * 0.5, 32, new THREE.MeshLambertMaterial({ color: 0x64748b }), false); hub.position.z = L / 2 + R * 0.12; fixedGroup.add(hub); }
      addLabel(anchor(fixedGroup, 0, R * 1.5, L / 2 + R * 0.4), "船首シールド（非回転）", "#cbd5e1");
      // 非回転：後部の鉢状 工業・推進区画と分散推進器
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(R * 1.25, 40, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x7c6f64, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      bowl.rotation.x = Math.PI / 2; bowl.position.z = -L / 2 - R * 0.15; fixedGroup.add(bowl);
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, n = new THREE.Mesh(new THREE.ConeGeometry(R * 0.12, R * 0.45, 12), new THREE.MeshLambertMaterial({ color: 0xf97316 })); n.rotation.x = -Math.PI / 2; n.position.set(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8, -L / 2 - R * 1.35); fixedGroup.add(n); }
      addLabel(anchor(fixedGroup, 0, -R * 1.6, -L / 2 - R * 0.8), "後部 工業・推進区画（非回転）", "#fdba74");
    }
    // 軸上照明（非回転）
    const rod = cylinder(Math.max(0.01, R * 0.012), L * 1.02, 12, new THREE.MeshBasicMaterial({ color: 0xfffbeb }), false); fixedGroup.add(rod);
    fixedGroup.add(cylinder(R * 0.05, L, 16, new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.18, depthWrite: false })));
    addLabel(anchor(fixedGroup, 0, R * 0.1, L * 0.18), "軸上照明（非回転）", "#fef08a");
    addLabel(anchor(fixedGroup, 0, 0, L / 2 + R * 2.4), "▲ 船首・北（進行方向）", "#7dd3fc");
    addLabel(anchor(fixedGroup, 0, 0, -L / 2 - R * 2.3), "▼ 船尾・南", "#7dd3fc");
    // city labels on the rotating surface: a handful of anchors (capitals of the largest prefectures)
    if (ShipApp.view.cities) for (const name of ["東京", "大阪市", "名古屋市", "札幌市", "福岡市", "那覇市"]) {
      const c = lay.cities.find((q) => q.name === name); if (!c) continue;
      if (c.pos[1] < f.y - f.h / 2 || c.pos[1] > f.y + f.h / 2) continue;
      const p = C.toCylinder(c.pos[0], c.pos[1], f, R, 0.02); addLabel(anchor(spinGroup, p[0], p[1], p[2]), name.replace(/市$/, ""), "#fff");
    }
    for (const grp of [spinGroup, fixedGroup]) grp.traverse((n) => { if (n.material) n.material.clippingPlanes = clipPlanes; });
    built = { R, L, f };
    ShipApp.clean3d();
    updateSpinNote();
  }
  let rebuildTimer = null;
  function rebuildSoon() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => { build(); }, 250); }

  // ---------------------------------------------------------------- camera presets
  function setView(v) {
    current = v; build();
    const { R, L, f } = built;
    controls.minDistance = 0.001; controls.maxDistance = Math.max(50, L * 6);
    spinGroup.rotation.z = 0;
    if (v === "overview") { // bow up on screen, like the 2D sheet
      const d = (L * 0.62 + R * 2) / Math.tan((camera.fov * Math.PI) / 360) / Math.min(1, camera.aspect * 1.6); camera.position.set(d * 0.92, d * 0.38, 0); controls.target.set(0, 0, 0); camera.up.set(0, 0, 1); camera.near = 0.01; }
    else if (v === "section") { camera.position.set(R * 0.6, R * 0.5, R * 4.6); controls.target.set(0, 0, -R * 0.5); camera.near = 0.01; }
    else if (v === "inside") {
      // stand on the ground near Tokyo (150 m up), facing the bow; the land curves up overhead
      const tokyo = ShipApp.layout.cities.find((c) => c.name === "東京") || { pos: [f.x, f.y] };
      const p = C.toCylinder(tokyo.pos[0], tokyo.pos[1], f, R, 0.15), ahead = C.toCylinder(tokyo.pos[0], tokyo.pos[1] + Math.min(4, L * 0.1), f, R, R * 0.55);
      camera.position.set(p[0], p[1], p[2]); controls.target.set(ahead[0], ahead[1], ahead[2]); camera.near = 0.002;
      camera.up.set(-p[0], -p[1], 0).normalize();
    }
    if (v === "section") camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix(); controls.update();
  }
  function updateSpinNote() {
    const ph = C.physics(ShipApp.state.ship);
    $("spinNote").textContent = `物理値：${ph.rpm.toFixed(3)} rpm・1回転 ${ph.periodS.toFixed(1)} 秒・周速 ${ph.rimSpeedMs.toFixed(0)} m/s（3G）。表示：${spinMul === 0 ? "停止" : spinMul === 1 ? "実速度" : spinMul + "倍速（見かけ）"}。区画：回転＝居住シリンダー／非回転＝シールド・軸・後部。`;
  }

  // ---------------------------------------------------------------- loop
  const tmp = new THREE.Vector3(); let last = 0;
  function loop(t) {
    if (!running) return; requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - last) / 1000 || 0); last = t;
    if (spinMul && current !== "inside") spinGroup.rotation.z += C.physics(ShipApp.state.ship).omegaRadS * spinMul * dt;
    controls.update(); renderer.render(scene, camera);
    const w = host.clientWidth, h = host.clientHeight;
    for (const { obj, el } of labels) {
      obj.getWorldPosition(tmp); const d = tmp.distanceTo(camera.position); tmp.project(camera);
      if (tmp.z > 1 || tmp.z < -1 || d > (built ? built.L * 4 : 1e9)) { el.style.display = "none"; continue; }
      el.style.display = ""; el.style.left = ((tmp.x * 0.5 + 0.5) * w).toFixed(1) + "px"; el.style.top = ((-tmp.y * 0.5 + 0.5) * h).toFixed(1) + "px";
    }
  }
  function show(v) {
    if (!renderer) init();
    $("loading3d").hidden = false;
    requestAnimationFrame(() => { resize(); setView(v); $("loading3d").hidden = true; if (!running) { running = true; last = performance.now(); requestAnimationFrame(loop); } });
  }
  function pause() { running = false; }
  for (const b of document.querySelectorAll("[data-spin]")) b.addEventListener("click", () => { spinMul = +b.dataset.spin; for (const x of document.querySelectorAll("[data-spin]")) x.setAttribute("aria-pressed", String(x === b)); updateSpinNote(); });
  $("q3d").addEventListener("click", () => { hiQ = !hiQ; $("q3d").setAttribute("aria-pressed", String(hiQ)); if (renderer) build(); });
  $("layers3d").addEventListener("click", () => { showLayers = !showLayers; $("layers3d").setAttribute("aria-pressed", String(showLayers)); if (renderer) build(); });

  window.Ship3D = { show, pause, setView: (v) => setView(v), get built() { return built; }, get renderer() { return renderer; }, get texture() { return texCanvas; }, get spin() { return spinGroup && spinGroup.rotation.z; } };
})();
