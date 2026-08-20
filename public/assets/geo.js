// Projecting coordinates onto the self-hosted world map.
//
// worldmap.js is equirectangular, viewBox 1000x403, Antarctica clipped off.
// Longitude spans the full width, so the scale falls straight out: 1000px/360°.
// The vertical offset was derived from the path bounding box (y 4..391) against
// Natural Earth's land extremes — 83.6°N at Greenland's tip, -55.9°S at Cape
// Horn — which puts latitude 0 of the viewBox at 85.04°N. Validated by plotting
// known cities and asserting each lands inside its own country's path.
//
// No tile server, no map library. A tile request would leak every viewer's IP
// to a third party, which the privacy page promises doesn't happen.

export const PX_PER_DEG = 1000 / 360;   // 2.7778
export const TOP_LAT = 85.04;

export const projectX = (lon) => (Number(lon) + 180) * PX_PER_DEG;
export const projectY = (lat) => (TOP_LAT - Number(lat)) * PX_PER_DEG;

export const project = (lat, lon) => [projectX(lon), projectY(lat)];

export const onMap = (lat, lon) =>
  Number.isFinite(+lat) && Number.isFinite(+lon) &&
  +lat <= TOP_LAT && +lat >= TOP_LAT - 403 / PX_PER_DEG &&
  +lon >= -180 && +lon <= 180;

// Venue coordinates are rounded before they are ever stored. 4 decimals is
// ~11m: precise enough to place a bar on a street, and the most precision a
// public record of "where someone drinks" has any business carrying.
export const VENUE_DP = 4;
export const roundCoord = (n) => Math.round(Number(n) * 10 ** VENUE_DP) / 10 ** VENUE_DP;
