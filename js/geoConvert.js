// Shared math for V0.3's 3D/2D toggle: converting between a point on the
// 3D globe (camera direction from its center) and a plain lng/lat, and a
// rough correspondence between the 3D camera's distance-from-center and
// OpenLayers's zoom level.
//
// Longitude/latitude convention matches how the 3D globe's texture is
// actually mapped in js/globe3d.js (THREE.SphereGeometry's default UV
// layout, verified against the equirectangular texture used there): +Y is
// the north pole, and longitude increases eastward starting from the
// texture's left edge at -180.

export function directionToLngLat(x, y, z) {
  const clampedY = Math.min(1, Math.max(-1, y));
  const theta = Math.acos(clampedY); // 0 at north pole, PI at south pole
  let phi = Math.atan2(z, -x); // (-PI, PI]
  if (phi < 0) phi += Math.PI * 2; // normalize to [0, 2*PI)
  return {
    lng: phi * (180 / Math.PI) - 180,
    lat: 90 - theta * (180 / Math.PI),
  };
}

export function lngLatToDirection(lngDeg, latDeg) {
  const theta = (90 - latDeg) * (Math.PI / 180);
  const phi = (lngDeg + 180) * (Math.PI / 180);
  const sinTheta = Math.sin(theta);
  return {
    x: -Math.cos(phi) * sinTheta,
    y: Math.cos(theta),
    z: Math.sin(phi) * sinTheta,
  };
}

// Deliberately approximate: the 3D camera's usable distance range (see
// MIN/MAX_DISTANCE in js/globe3d.js) is much narrower than OpenLayers's
// zoom range (which can go far past what the 3D view currently supports,
// since there's no terrain/city detail to zoom into yet -- see V0.4+).
// Calibrated so each view's own shared starting point (distance 3,
// zoom 2) maps exactly to the other; requesting a closer 3D zoom than
// minDistance allows just clamps there instead of erroring. Revisit once
// a later version gives the 3D view a reason to zoom in much further.
const ZOOM_DISTANCE_K = 12; // referenceDistance(3) * 2^referenceZoom(2)

export function distanceToZoom(distance) {
  return Math.log2(ZOOM_DISTANCE_K / distance);
}

export function zoomToDistance(zoom, minDistance, maxDistance) {
  const distance = ZOOM_DISTANCE_K / Math.pow(2, zoom);
  return Math.min(maxDistance, Math.max(minDistance, distance));
}
