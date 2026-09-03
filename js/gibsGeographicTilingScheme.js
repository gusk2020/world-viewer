// NASA GIBS's geographic (EPSG:4326) tile pyramid does NOT use the simple
// "2x1 at level 0, doubling every level" layout Cesium's built-in
// GeographicTilingScheme assumes -- it uses its own irregular progression
// (2x1, 3x2, 5x3, 10x5, 20x10, ...). Using the default scheme silently
// requests the wrong tiles for a given level, which showed up as imagery
// covering only part of the globe with black gaps. This is NASA's own
// published fix, ported from their gibs-web-examples repo
// (examples/cesium/gibs.js) and trimmed to the "500m" matrix set this app
// uses (one level shallower than the "250m" set shown in their example --
// same relationship already confirmed correct for the polar projections
// in an earlier version of this app).
const LEVELS = [
  { width: 2, height: 1, resolution: 0.009817477042468103 },
  { width: 3, height: 2, resolution: 0.004908738521234052 },
  { width: 5, height: 3, resolution: 0.002454369260617026 },
  { width: 10, height: 5, resolution: 0.001227184630308513 },
  { width: 20, height: 10, resolution: 0.0006135923151542565 },
  { width: 40, height: 20, resolution: 0.00030679615757712823 },
  { width: 80, height: 40, resolution: 0.00015339807878856412 },
  { width: 160, height: 80, resolution: 0.00007669903939428206 },
];
const TILE_PIXELS = 512;

export function createGibsGeographicTilingScheme() {
  const scheme = new Cesium.GeographicTilingScheme();
  const rectangle = Cesium.Rectangle.MAX_VALUE;

  scheme.getNumberOfXTilesAtLevel = (level) => LEVELS[level].width;
  scheme.getNumberOfYTilesAtLevel = (level) => LEVELS[level].height;

  scheme.tileXYToRectangle = (x, y, level, result) => {
    const { resolution } = LEVELS[level];
    const tileWidth = resolution * TILE_PIXELS;
    const west = x * tileWidth + rectangle.west;
    const east = (x + 1) * tileWidth + rectangle.west;
    const north = rectangle.north - y * tileWidth;
    const south = rectangle.north - (y + 1) * tileWidth;
    if (!result) result = new Cesium.Rectangle(0, 0, 0, 0);
    result.west = west;
    result.south = south;
    result.east = east;
    result.north = north;
    return result;
  };

  scheme.positionToTileXY = (position, level, result) => {
    if (!Cesium.Rectangle.contains(rectangle, position)) return undefined;
    const { width: xTiles, height: yTiles, resolution } = LEVELS[level];
    const tileWidth = resolution * TILE_PIXELS;

    let longitude = position.longitude;
    if (rectangle.east < rectangle.west) longitude += Cesium.Math.TWO_PI;

    let x = Math.floor((longitude - rectangle.west) / tileWidth);
    if (x >= xTiles) x = xTiles - 1;

    let y = Math.floor((rectangle.north - position.latitude) / tileWidth);
    if (y > yTiles) y = yTiles - 1;

    if (!result) result = new Cesium.Cartesian2(0, 0);
    result.x = x;
    result.y = y;
    return result;
  };

  return scheme;
}

export const GIBS_GEOGRAPHIC_MAX_LEVEL = LEVELS.length - 1;
