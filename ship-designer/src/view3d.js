// 3D view (v13). 外部／内部の2視点、Google Earth風の球状操作器（回す・ひねる・つまむ）と主画面のカメラを同期。
// 居住シリンダー（回転）の内面に2Dと同じ地図を貼り、地形は標高を半径方向に反映する。外側の面はグレー（透過で内側の地表を見通せる）。
(function () {
  "use strict";
  if (!window.THREE) { window.Ship3D = null; return; }
  const $ = (id) => document.getElementById(id), C = window.ShipCore, V3 = THREE.Vector3, Q = THREE.Quaternion;
  const host = $("view3d"), labelsEl = $("labels3d"), VISUAL_STEP_M = 5; // 岸の段差（描画だけ。標高・体積・面積などの計算値は変えない）
  let groundMat = null, extMat = null, terrain3d = true, seeThru = true, lookDir = "ahead", eyeH = 150, maxH = 0, sampler = null, renderer = null, scene, camera, spinGroup, fixedGroup, tex, texCanvas, built = null, running = false, spinMul = 20, hiQ = false, showLayers = true, mode = "outside";
  let gRenderer = null, gScene, gCam, gObj;
  const labels = [], nav = { q: new Q(), target: new V3(), dist: 100, fov: 50 }, eyePos = new V3();

  // ------------------------------------------------------------ camera model (own trackball; supports roll)
  function applyCamera() {
    camera.fov = nav.fov; camera.quaternion.copy(nav.q);
    if (mode === "outside") camera.position.copy(nav.target).add(new V3(0, 0, nav.dist).applyQuaternion(nav.q)); else camera.position.copy(eyePos);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  function rotate(dx, dy, gain) { // 画面上の指の移動(px)。外部＝物体を回す、内部＝見回す（向きが逆）
    const k = 0.0055 * (gain || 1), s = mode === "outside" ? -1 : 1;
    nav.q.multiply(new Q().setFromAxisAngle(new V3(0, 1, 0), s * dx * k)).multiply(new Q().setFromAxisAngle(new V3(1, 0, 0), s * dy * k)).normalize(); applyCamera();
  }
  function roll(a) { nav.q.multiply(new Q().setFromAxisAngle(new V3(0, 0, 1), a)).normalize(); applyCamera(); }
  function zoom(sc) { if (!(sc > 0)) return; if (mode === "outside") { const L = built ? built.L : 50; nav.dist = Math.max(0.05, Math.min(L * 8, nav.dist / sc)); } else nav.fov = Math.max(12, Math.min(100, nav.fov / sc)); applyCamera(); }
  function lookQ(eye, target, up) { return new Q().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, target, up)); }
  function resetOutside() {
    const { R, L } = built; nav.fov = 50; const asp = camera.aspect || 0.6, d = (L * 0.62 + R * 2) / Math.tan((nav.fov * Math.PI) / 360) / Math.min(1, asp * 1.6);
    nav.target.set(0, 0, 0); nav.dist = d; nav.q.copy(lookQ(new V3(d * 0.92, d * 0.38, 0), nav.target, new V3(0, 0, 1))); camera.near = Math.max(0.01, d / 4000); camera.far = d * 12 + L * 4; applyCamera();
  }
  /** 船内地表：東京付近の地表から。高さは地表から軸方向へ eyeH(m)。視線は船首方向、または真上（反対側の地面と軸）。 */
  function placeInside(keepLook) {
    const { R, L, f } = built, lay = ShipApp.layout, tokyo = lay.cities.find((c) => c.name === "東京") || { pos: [f.x, f.y] };
    const gh = sampler ? sampler(tokyo.pos[0], tokyo.pos[1]) / 1000 : 0, inset = gh + eyeH / 1000, p = C.toCylinder(tokyo.pos[0], tokyo.pos[1], f, R, inset);
    eyePos.set(p[0], p[1], p[2]);
    if (!keepLook) {
      if (lookDir === "up") { const o = C.toCylinder(tokyo.pos[0] + f.w / 2, tokyo.pos[1] + Math.min(4, L * 0.08), f, R, 0); nav.q.copy(lookQ(eyePos, new V3(o[0], o[1], o[2]), new V3(0, 0, 1))); }
      else { const a = C.toCylinder(tokyo.pos[0], tokyo.pos[1] + Math.min(4, L * 0.1), f, R, Math.max(inset, R * 0.55)); nav.q.copy(lookQ(eyePos, new V3(a[0], a[1], a[2]), new V3(-p[0], -p[1], 0).normalize())); }
      nav.fov = 60;
    }
    camera.near = 0.002; camera.far = L * 6; applyCamera();
  }
  function resetView() { if (!built) return; if (mode === "outside") resetOutside(); else placeInside(false); }
  function setMode(m) {
    mode = m; $("btnInOut").setAttribute("aria-pressed", String(m === "inside")); $("insideCtl").hidden = m !== "inside";
    if (built) { build(); resetView(); }
  }

  // ------------------------------------------------------------ init
  function init() {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); host.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x030914);
    camera = new THREE.PerspectiveCamera(50, 1, 0.002, 2000);
    scene.add(new THREE.AmbientLight(0xbfd8ff, 0.8)); scene.add(new THREE.PointLight(0xfff3d0, 1.3, 0, 1));
    spinGroup = new THREE.Group(); fixedGroup = new THREE.Group(); scene.add(spinGroup, fixedGroup);
    attachGestures(renderer.domElement, 1);
    renderer.domElement.addEventListener("wheel", (e) => { e.preventDefault(); zoom(Math.exp(-e.deltaY / 400)); }, { passive: false });
    initGizmo();
    window.addEventListener("resize", resize);
    ShipApp.onChange(() => { if (running) rebuildSoon(); });
  }
  function resize() { if (!renderer) return; const w = host.clientWidth || 1, h = host.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }

  // ------------------------------------------------------------ gestures: 1本指=回す／2本指=ひねり＋つまみ。主画面と操作器で共通
  function attachGestures(el, gain) {
    const ptr = new Map(); let last = null;
    const two = () => { const a = [...ptr.values()]; return { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, ang: Math.atan2(a[1].y - a[0].y, a[1].x - a[0].x) }; };
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {} ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = ptr.size === 2 ? two() : null; });
    el.addEventListener("pointermove", (e) => {
      const p = ptr.get(e.pointerId); if (!p) return; e.preventDefault(); const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (ptr.size === 1) rotate(dx, dy, gain);
      else if (ptr.size === 2) { const n = two(); if (last) { zoom(n.d / last.d); let da = n.ang - last.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; roll(-da); } last = n; }
    });
    const up = (e) => { ptr.delete(e.pointerId); last = ptr.size === 2 ? two() : null; };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("lostpointercapture", up);
  }

  // ------------------------------------------------------------ 球状操作器（半透明の球殻＋船首を指す矢印）
  function initGizmo() {
    const cv = $("gizmo"), dpr = Math.min(window.devicePixelRatio || 1, 2);
    gRenderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true }); gRenderer.setPixelRatio(dpr); gRenderer.setSize(112, 112, false); gRenderer.setClearColor(0x000000, 0);
    gScene = new THREE.Scene(); gCam = new THREE.PerspectiveCamera(32, 1, 0.1, 20); gCam.position.set(0, 0, 4.4); gObj = new THREE.Group(); gScene.add(gObj);
    gScene.add(new THREE.AmbientLight(0xffffff, 0.9)); const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(2, 3, 4); gScene.add(dl);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), new THREE.MeshPhongMaterial({ color: 0x4aa3d6, transparent: true, opacity: 0.2, depthWrite: false, shininess: 60 }));
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(1.002, 12, 8)), new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.45 }));
    const mat = new THREE.MeshPhongMaterial({ color: 0xffd166, transparent: true, opacity: 0.62, depthWrite: false });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.0, 14), mat); shaft.rotation.x = Math.PI / 2; shaft.position.z = -0.1;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.42, 18), mat); tip.rotation.x = Math.PI / 2; tip.position.z = 0.62; // +Z = 船首・北
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 20), new THREE.MeshPhongMaterial({ color: 0xc0c8d0, transparent: true, opacity: 0.6 })); tail.position.z = -0.62;
    gObj.add(shell, wire, shaft, tip, tail); attachGestures(cv, 1.35);
    $("btnInOut").onclick = () => setMode(mode === "outside" ? "inside" : "outside");
  }

  // ------------------------------------------------------------ map texture (2Dと同じ描画)
  function paintTexture() {
    const f = ShipApp.layout.frame, TW = hiQ ? 2048 : 1024, TH = Math.min(hiQ ? 8192 : 4096, Math.max(256, Math.round((TW * f.h) / f.w)));
    if (!texCanvas) texCanvas = document.createElement("canvas"); texCanvas.width = TW; texCanvas.height = TH;
    ShipApp.paintTexture(texCanvas.getContext("2d"), TW, TH, hiQ);
    if (!tex) { tex = new THREE.CanvasTexture(texCanvas); tex.wrapS = THREE.RepeatWrapping; }
    tex.image = texCanvas; tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); tex.needsUpdate = true;
  }

  // ------------------------------------------------------------ geometry
  function disposeGroup(g) { while (g.children.length) { const o = g.children.pop(); o.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material && n.material !== tex) { if (n.material.map && n.material.map !== tex) n.material.map.dispose(); n.material.dispose(); } }); } }
  function cylinder(R, L, seg, mat, open) { const g = new THREE.CylinderGeometry(R, R, L, seg, 1, open !== false); g.rotateX(Math.PI / 2); return new THREE.Mesh(g, mat); }
  function addLabel(obj, text, cls) { const el = document.createElement("div"); el.textContent = text; if (cls) el.style.color = cls; labelsEl.appendChild(el); labels.push({ obj, el }); }
  function anchor(group, x, y, z) { const o = new THREE.Object3D(); o.position.set(x, y, z); group.add(o); return o; }

  function build() {
    const lay = ShipApp.layout, st = ShipApp.state, f = lay.frame, R = st.ship.innerDiameterKm / 2, L = st.ship.cylinderLengthKm, inside = mode === "inside";
    disposeGroup(spinGroup); disposeGroup(fixedGroup); labels.length = 0; labelsEl.innerHTML = "";
    paintTexture();
    const seg = hiQ ? 512 : 160, rows = Math.max(1, Math.round(L / (hiQ ? 0.07 : 0.12)));
    const geo = new THREE.CylinderGeometry(R, R, L, seg, rows, true);
    geo.rotateX(Math.PI / 2); // axis -> z; +z = 船首
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); uv.needsUpdate = true; // 内側から見て東が右
    maxH = 0; sampler = null;
    if (terrain3d) {
      try {
        sampler = ShipApp.heightSampler(); const mk = ShipApp.waterMask(), pos = geo.attributes.position, w = f.w, left = f.x - w / 2;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); let th = Math.atan2(-x, -y); if (th < 0) th += 2 * Math.PI;
          const sx = left + (th / (2 * Math.PI)) * w, sy = f.y + z; let hgt = sampler(sx, sy); if (hgt > maxH) maxH = hgt;
          if (mk) { const wv = mk(sx, sy); if (wv === 2) hgt = 0; } // 湖は水面
          const vis = hgt > 0 ? hgt + VISUAL_STEP_M : 0; // 陸は水面より5m高く描く（視認用）
          const k = (R - vis / 1000) / R; pos.setXYZ(i, x * k, y * k, z);
        }
        pos.needsUpdate = true; geo.computeVertexNormals();
      } catch (e) { console.error(e); }
    }
    groundMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.BackSide }); // 内側＝本来の色
    const ground = new THREE.Mesh(geo, groundMat); ground.renderOrder = 1; spinGroup.add(ground);
    extMat = new THREE.MeshLambertMaterial({ color: 0x8c929a, side: THREE.FrontSide, transparent: seeThru, opacity: seeThru ? 0.32 : 1, depthWrite: !seeThru }); // 外側＝地形色に関係なくグレー
    const ext = new THREE.Mesh(geo, extMat); ext.renderOrder = 2; ext.visible = !inside; spinGroup.add(ext);
    if (showLayers) {
      spinGroup.add(cylinder(R * 1.035, L, 96, new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })));
      spinGroup.add(cylinder(R * 1.07, L, 64, new THREE.MeshBasicMaterial({ color: 0x10b981, wireframe: true, transparent: true, opacity: 0.06 })));
      for (const z of [-L / 2, L / 2]) { const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.995, R * 1.07, 96), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })); ring.position.z = z; spinGroup.add(ring); }
      addLabel(anchor(spinGroup, 0, R * 1.07, -L * 0.3), "地下 生命維持・物質循環", "#7ee8d8");
      const shield = new THREE.Mesh(new THREE.SphereGeometry(R * 1.9, 48, 12, 0, Math.PI * 2, 0, 0.62), new THREE.MeshLambertMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      shield.rotation.x = Math.PI / 2; shield.position.z = L / 2 + R * 0.25 - R * 1.9 * Math.cos(0.62); fixedGroup.add(shield);
      { const hub = cylinder(R * 0.55, R * 0.5, 32, new THREE.MeshLambertMaterial({ color: 0x64748b }), false); hub.position.z = L / 2 + R * 0.12; fixedGroup.add(hub); }
      addLabel(anchor(fixedGroup, 0, R * 1.5, L / 2 + R * 0.4), "船首シールド（非回転）", "#cbd5e1");
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(R * 1.25, 40, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x7c6f64, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      bowl.rotation.x = Math.PI / 2; bowl.position.z = -L / 2 - R * 0.15; fixedGroup.add(bowl);
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, n = new THREE.Mesh(new THREE.ConeGeometry(R * 0.12, R * 0.45, 12), new THREE.MeshLambertMaterial({ color: 0xf97316 })); n.rotation.x = -Math.PI / 2; n.position.set(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8, -L / 2 - R * 1.35); fixedGroup.add(n); }
      addLabel(anchor(fixedGroup, 0, -R * 1.6, -L / 2 - R * 0.8), "後部 工業・推進区画（非回転）", "#fdba74");
    }
    const AX = st.ship.axisDiameterM / 2000; // 中心軸の半径(km)。2D断面・3D外部・船内視点で共通
    fixedGroup.add(cylinder(AX, L * 1.02, 24, new THREE.MeshBasicMaterial({ color: 0xfffbeb }), false));
    addLabel(anchor(fixedGroup, 0, R * 0.08, L * 0.18), `中心軸 直径${st.ship.axisDiameterM}m・軸上照明（非回転）`, "#fef08a");
    addLabel(anchor(fixedGroup, 0, 0, L / 2 + R * 2.4), "▲ 船首・北（進行方向）", "#7dd3fc"); addLabel(anchor(fixedGroup, 0, 0, -L / 2 - R * 2.3), "▼ 船尾・南", "#7dd3fc");
    if (ShipApp.view.cities) for (const name of ["東京", "大阪市", "名古屋市", "札幌市", "福岡市", "那覇市"]) {
      const c = lay.cities.find((q) => q.name === name); if (!c || c.pos[1] < f.y - f.h / 2 || c.pos[1] > f.y + f.h / 2) continue;
      const gh = sampler ? sampler(c.pos[0], c.pos[1]) / 1000 : 0, p = C.toCylinder(c.pos[0], c.pos[1], f, R, 0.02 + gh); addLabel(anchor(spinGroup, p[0], p[1], p[2]), name.replace(/市$/, ""), "#fff");
    }
    built = { R, L, f, maxH, axisR: AX, visualStepM: VISUAL_STEP_M, mode };
    $("terrainNote").textContent = terrain3d ? `地形：水平は1/${st.terrain.japanScaleDenominator}、標高は10/${st.terrain.japanScaleDenominator}×倍率${st.terrain.heightLayer.globalScale.toFixed(2)}。最高点 ${maxH.toFixed(0)}m（居住内半径${R * 1000}m）。海岸・湖岸は陸が水面より${VISUAL_STEP_M}m高く見えるよう描きます（描画だけで、標高・面積・体積などの計算値は変えません）。` : "地形の高さを切っています（平らな表示）。";
    ShipApp.clean3d(); updateSpinNote();
  }
  let rebuildTimer = null;
  function rebuildSoon() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => { const keep = built; build(); if (mode === "inside") placeInside(true); }, 250); }
  function updateSpinNote() {
    const ph = C.physics(ShipApp.state.ship);
    $("spinNote").textContent = `物理値：${ph.rpm.toFixed(3)} rpm・1回転 ${ph.periodS.toFixed(1)} 秒・周速 ${ph.rimSpeedMs.toFixed(0)} m/s（${ShipApp.state.ship.gravityG}G）。表示：${spinMul === 0 ? "停止" : spinMul === 1 ? "実速度" : spinMul + "倍速（見かけ）"}。区画：回転＝居住シリンダー／非回転＝シールド・軸・後部。`;
  }

  // ------------------------------------------------------------ loop
  const tmp = new V3(), gq = new Q(); let last = 0;
  function loop(t) {
    if (!running) return; requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - last) / 1000 || 0); last = t;
    if (spinMul && mode !== "inside") spinGroup.rotation.z += C.physics(ShipApp.state.ship).omegaRadS * spinMul * dt;
    renderer.render(scene, camera);
    gObj.quaternion.copy(camera.quaternion).invert(); gRenderer.render(gScene, gCam); // 操作器：主画面のカメラの向きと常に同期
    const w = host.clientWidth, h = host.clientHeight;
    for (const { obj, el } of labels) {
      obj.getWorldPosition(tmp); const d = tmp.distanceTo(camera.position); tmp.project(camera);
      if (tmp.z > 1 || tmp.z < -1 || d > (built ? built.L * 4 : 1e9)) { el.style.display = "none"; continue; }
      el.style.display = ""; el.style.left = ((tmp.x * 0.5 + 0.5) * w).toFixed(1) + "px"; el.style.top = ((-tmp.y * 0.5 + 0.5) * h).toFixed(1) + "px";
    }
  }
  function show() {
    if (!renderer) init(); $("loading3d").hidden = false;
    requestAnimationFrame(() => { resize(); build(); resetView(); $("loading3d").hidden = true; if (!running) { running = true; last = performance.now(); requestAnimationFrame(loop); } });
  }
  function pause() { running = false; }
  for (const b of document.querySelectorAll("[data-spin]")) b.addEventListener("click", () => { spinMul = +b.dataset.spin; for (const x of document.querySelectorAll("[data-spin]")) x.setAttribute("aria-pressed", String(x === b)); updateSpinNote(); });
  $("terrain3d").addEventListener("click", () => { terrain3d = !terrain3d; $("terrain3d").setAttribute("aria-pressed", String(terrain3d)); if (renderer) build(); });
  $("seeThru3d").addEventListener("click", () => { seeThru = !seeThru; $("seeThru3d").setAttribute("aria-pressed", String(seeThru)); if (renderer) build(); });
  for (const b of document.querySelectorAll("[data-look]")) b.addEventListener("click", () => { lookDir = b.dataset.look; for (const x of document.querySelectorAll("[data-look]")) x.setAttribute("aria-pressed", String(x === b)); if (built && mode === "inside") placeInside(false); });
  const eyeApply = (v) => { eyeH = Math.max(2, Math.min(2950, Math.round(v))); $("eyeH").value = eyeH; $("eyeHv").textContent = eyeH >= 1000 ? (eyeH / 1000).toFixed(2) + " km" : eyeH + " m"; if (built && mode === "inside") placeInside(true); };
  $("eyeH").addEventListener("input", (e) => eyeApply(+e.target.value));
  for (const b of document.querySelectorAll("[data-eye]")) { let timer = null, n = 0; const step = () => { n++; eyeApply(eyeH + (+b.dataset.eye) * (n > 20 ? 50 : n > 8 ? 10 : 1)); }, stop = () => { clearTimeout(timer); clearInterval(timer); timer = null; n = 0; };
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); stop(); step(); timer = setTimeout(() => { timer = setInterval(step, 70); }, 350); try { b.setPointerCapture(e.pointerId); } catch (_) {} }); b.addEventListener("pointerup", stop); b.addEventListener("pointercancel", stop); b.addEventListener("lostpointercapture", stop); }
  eyeApply(150);
  $("q3d").addEventListener("click", () => { hiQ = !hiQ; $("q3d").setAttribute("aria-pressed", String(hiQ)); if (renderer) build(); });
  $("layers3d").addEventListener("click", () => { showLayers = !showLayers; $("layers3d").setAttribute("aria-pressed", String(showLayers)); if (renderer) build(); });

  window.Ship3D = { show, pause, resize: () => resize(), resetView, setMode, get mode() { return mode; }, get built() { return built; }, get maxH() { return maxH; }, get camera() { return camera; }, get nav() { return nav; },
    get groundOpacity() { return extMat && extMat.opacity; }, get exteriorColor() { return extMat && extMat.color.getHex(); }, get interiorHasMap() { return !!(groundMat && groundMat.map); }, get interiorSide() { return groundMat && groundMat.side; },
    get gizmoQuaternion() { return gObj && gObj.quaternion; }, get eyeH() { return eyeH; }, get renderer() { return renderer; }, get texture() { return texCanvas; }, get spin() { return spinGroup && spinGroup.rotation.z; },
    // テスト用：操作器・主画面と同じ入力
    _rotate: rotate, _roll: roll, _zoom: zoom };
})();
