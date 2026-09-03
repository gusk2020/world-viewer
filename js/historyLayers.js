import { densifyRing } from "./geoUtils.js";

export async function loadEraIndex(config) {
  const res = await fetch(config.history.indexUrl);
  return res.json();
}

export function nearestKeyframe(eraIndex, year) {
  let best = eraIndex.keyframes[0];
  for (const kf of eraIndex.keyframes) {
    if (kf <= year) best = kf;
  }
  return best;
}

export function createEraLoader(config) {
  const cache = new Map();
  return function loadEra(year) {
    if (!cache.has(year)) {
      const url = config.history.eraUrlTemplate.replace("{year}", year);
      cache.set(year, fetch(url).then((res) => res.json()));
    }
    return cache.get(year);
  };
}

export function createHistoryDataSources() {
  return {
    territories: new Cesium.CustomDataSource("territories"),
    cities: new Cesium.CustomDataSource("cities"),
  };
}

export function applyEraData({ territories, cities }, eraDoc) {
  territories.entities.removeAll();
  for (const feature of eraDoc.territories.features) {
    const color = Cesium.Color.fromCssColorString(feature.properties.color);
    const ring = densifyRing(feature.geometry.coordinates[0].flat());
    territories.entities.add({
      // No `outline` here: Cesium doesn't support polygon outlines together
      // with terrain-clamped draping (the default for a polygon with no
      // `height` set) -- it just logs a warning and skips the outline.
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(ring),
        material: color.withAlpha(0.45),
      },
    });
  }

  cities.entities.removeAll();
  const citySize = { capital: 14, secondary: 11, third: 8 };
  for (const feature of eraDoc.cities.features) {
    const [lng, lat] = feature.geometry.coordinates;
    const color = Cesium.Color.fromCssColorString(feature.properties.color);
    cities.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat),
      point: {
        pixelSize: citySize[feature.properties.rank] || 8,
        color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: feature.properties.name,
        font: "13px sans-serif",
        pixelOffset: new Cesium.Cartesian2(0, -16),
        fillColor: Cesium.Color.fromCssColorString("#1b2a41"),
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }
}

export function setHistoryVisible({ territories, cities }, visible, citiesOn) {
  territories.show = visible;
  cities.show = visible && citiesOn;
}
