export function createGlacierDataSource(glaciersGeoJson) {
  const dataSource = new Cesium.CustomDataSource("glaciers");
  for (const feature of glaciersGeoJson.features) {
    const ring = feature.geometry.coordinates[0].flat();
    dataSource.entities.add({
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(ring),
        material: Cesium.Color.fromCssColorString("#eaf6ff").withAlpha(0.85),
      },
    });
  }
  return dataSource;
}
