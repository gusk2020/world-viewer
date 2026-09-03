// Cesium's Entity polygons drape a straight geodesic line between each
// pair of ring vertices. Our placeholder territory/glacier boxes have
// edges spanning tens of degrees (the glacier caps span the full 360
// degrees of longitude), and a geodesic between two such distant points
// visibly bows away from where a simple flat rectangle "should" be --
// reported by the user as territories looking curved/misplaced, and is
// also why the full-longitude glacier ring barely rendered at all. Insert
// intermediate points along each edge so every segment is short enough to
// look straight.
export function densifyRing(ring, maxStepDegrees = 5) {
  const out = [];
  const pointCount = ring.length / 2;
  for (let i = 0; i < pointCount; i++) {
    const lng0 = ring[i * 2];
    const lat0 = ring[i * 2 + 1];
    const next = (i + 1) % pointCount;
    const lng1 = ring[next * 2];
    const lat1 = ring[next * 2 + 1];
    out.push(lng0, lat0);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(lng1 - lng0), Math.abs(lat1 - lat0)) / maxStepDegrees));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push(lng0 + (lng1 - lng0) * t, lat0 + (lat1 - lat0) * t);
    }
  }
  return out;
}
