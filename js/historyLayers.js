const EMPTY_FC = { type: "FeatureCollection", features: [] };

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

export function addHistoryLayers(map) {
  map.addSource("territories", { type: "geojson", data: EMPTY_FC });
  map.addSource("cities", { type: "geojson", data: EMPTY_FC });

  map.addLayer(
    {
      id: "territories-fill",
      type: "fill",
      source: "territories",
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": 0.45,
      },
    },
    "countries-boundary"
  );

  map.addLayer(
    {
      id: "territories-outline",
      type: "line",
      source: "territories",
      paint: {
        "line-color": ["get", "color"],
        "line-width": 2,
      },
    },
    "countries-boundary"
  );

  map.addLayer({
    id: "city-circle",
    type: "circle",
    source: "cities",
    paint: {
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
      "circle-radius": ["match", ["get", "rank"], "capital", 8, "secondary", 6, 4],
    },
  });

  map.addLayer({
    id: "city-label",
    type: "symbol",
    source: "cities",
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Open Sans Semibold"],
      "text-size": 13,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
    },
    paint: {
      "text-color": "#1b2a41",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.4,
    },
  });
}

export function setTerritoriesVisible(map, visible) {
  const v = visible ? "visible" : "none";
  map.setLayoutProperty("territories-fill", "visibility", v);
  map.setLayoutProperty("territories-outline", "visibility", v);
}

export function setCitiesVisible(map, visible) {
  const v = visible ? "visible" : "none";
  map.setLayoutProperty("city-circle", "visibility", v);
  map.setLayoutProperty("city-label", "visibility", v);
}

export function applyEraData(map, eraDoc) {
  map.getSource("territories").setData(eraDoc.territories);
  map.getSource("cities").setData(eraDoc.cities);
}
