// 保存スロット（pure）。船体案プリセット・名前付き保存・JSON読込を「保存スロット」1つの概念に統一する。
//   標準案（採用基準案など）は読み取り専用の原本（ShipCore.presetList から再生成できる）。利用者のスロットは保存・上書き・名前変更・複製・削除（ごみ箱で取り消し可）・JSON出力/読込ができる。
//   保存先はブラウザ内（localStorage）。端末に残すバックアップはJSON出力で。旧v10の保存（kasoku-ship-designer-v10-saves）は消さずにスロットへ移行する。
(function (root) {
  "use strict";
  const KEY = "kasoku-ship-slots-v13", LEGACY_KEY = "kasoku-ship-designer-v10-saves";
  const slug = (s) => String(s || "design").trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").slice(0, 40) || "design";
  const stamp = (d) => (d || new Date()).toISOString().slice(0, 10);
  const newId = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function createStore(storage) {
    let data = { version: 1, slots: [], trash: [], hiddenStd: [] }, writable = true;
    const read = (k) => { try { return storage ? storage.getItem(k) : null; } catch (_) { return null; } };
    const raw = read(KEY);
    if (raw) { try { const d = JSON.parse(raw); if (d && Array.isArray(d.slots)) data = { version: 1, slots: d.slots, trash: d.trash || [], hiddenStd: d.hiddenStd || [] }; } catch (_) {} }
    else { // 旧v10の保存を移行（旧キーは触らない＝バックアップとして残る）
      const old = read(LEGACY_KEY); if (old) { try { const arr = JSON.parse(old); if (Array.isArray(arr)) for (const d of arr) if (d && d.ship && d.terrain) data.slots.push({ id: newId(), name: d.name || "名称未設定", fileName: slug(d.name) + ".json", savedAt: d.createdAt || new Date().toISOString(), createdAt: d.createdAt || new Date().toISOString(), origin: "旧v10の保存から移行", design: d }); } catch (_) {} }
    }
    const persist = () => { try { if (storage) storage.setItem(KEY, JSON.stringify(data)); return true; } catch (_) { writable = false; return false; } };
    if (!raw && data.slots.length) persist();
    const uniq = (base, key, exceptId) => { let n = base, i = 2; while (data.slots.some((s) => s[key] === n && s.id !== exceptId)) n = `${base} (${i++})`; return n; };
    const api = {
      get writable() { return writable; }, get data() { return data; },
      list: () => data.slots.slice(), trash: () => data.trash.slice(), hiddenStd: () => data.hiddenStd.slice(),
      get: (id) => data.slots.find((s) => s.id === id) || null,
      uniqueName: (b, ex) => uniq(b, "name", ex), uniqueFile: (b, ex) => uniq(b, "fileName", ex),
      defaultFileName: (name) => slug(name) + "-" + stamp() + ".json",
      /** 新規登録。名前・ファイル名が重なれば番号を付ける（上書きしない）。 */
      add(design, opt) { opt = opt || {}; const now = new Date().toISOString(), name = uniq(opt.name || design.name || "名称未設定", "name"), s = { id: newId(), name, fileName: uniq(opt.fileName || api.defaultFileName(name), "fileName"), savedAt: now, createdAt: now, origin: opt.origin || "新規保存", design: { ...design, name } }; data.slots.push(s); persist(); return s; },
      overwrite(id, design, opt) { const s = api.get(id); if (!s) throw new Error("対象のスロットがありません"); opt = opt || {}; s.design = { ...design, name: opt.name || s.name }; s.savedAt = new Date().toISOString(); if (opt.name) s.name = opt.name; if (opt.fileName) s.fileName = opt.fileName; persist(); return s; },
      rename(id, name, fileName) { const s = api.get(id); if (!s) throw new Error("対象のスロットがありません"); const n = String(name || "").trim(); if (!n) throw new Error("名前が空です"); if (data.slots.some((q) => q.id !== id && q.name === n)) throw new Error("同じ名前のスロットがあります"); s.name = n; s.design = { ...s.design, name: n }; if (fileName) s.fileName = uniq(fileName, "fileName", id); persist(); return s; },
      duplicate(id) { const s = api.get(id); if (!s) throw new Error("対象のスロットがありません"); return api.add(JSON.parse(JSON.stringify(s.design)), { name: s.name + " のコピー", fileName: s.fileName.replace(/\.json$/, "") + "-copy.json", origin: "複製（元：" + s.name + "）" }); },
      /** 複製元が標準案（原本）の場合 */
      addFromStandard(design, stdName) { return api.add(design, { name: stdName, origin: "標準案から複製：" + stdName }); },
      remove(id) { const i = data.slots.findIndex((s) => s.id === id); if (i < 0) throw new Error("対象のスロットがありません"); const [s] = data.slots.splice(i, 1); data.trash.push({ ...s, deletedAt: new Date().toISOString() }); data.trash = data.trash.slice(-20); persist(); return s; },
      restoreLast() { const t = data.trash.pop(); if (!t) return null; const { deletedAt, ...s } = t; s.name = uniq(s.name, "name"); data.slots.push(s); persist(); return s; },
      hideStd(id) { if (!data.hiddenStd.includes(id)) data.hiddenStd.push(id); persist(); }, showStdAll() { data.hiddenStd = []; persist(); },
      /** JSONの読み込み（単体／一括）。登録したスロットの配列を返す。 */
      importJSON(obj, opt) {
        const out = [], isBundle = obj && (obj.schema === "kasoku-world-cylinder-designs" || obj.schema === "kasoku-ship-designs" || obj.schema === "kasoku-ship-slots") && Array.isArray(obj.designs || obj.slots);
        const list = isBundle ? (obj.designs || obj.slots.map((s) => s.design)) : [obj];
        for (const d of list) { if (!d || !d.ship || !d.terrain) continue; out.push(api.add(d, { name: d.name, fileName: (opt && opt.fileName && !isBundle) ? opt.fileName : undefined, origin: "JSON読込" + (opt && opt.fileName ? "（" + opt.fileName + "）" : "") })); }
        return out;
      },
      exportAll: () => ({ schema: "kasoku-ship-slots", schemaVersion: 13, exportedAt: new Date().toISOString(), slots: data.slots.map((s) => ({ name: s.name, fileName: s.fileName, savedAt: s.savedAt, origin: s.origin, design: s.design })), designs: data.slots.map((s) => s.design) }),
    };
    return api;
  }
  root.ShipSlots = { createStore, slug, KEY, LEGACY_KEY }; if (typeof module !== "undefined" && module.exports) module.exports = root.ShipSlots;
})(typeof window !== "undefined" ? window : globalThis);
