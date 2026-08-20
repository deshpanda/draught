// The basemap's look, hand-written against Protomaps' nine vector layers.
//
// Filters are real expressions, not the legacy `["in", key, v1, v2]` form —
// MapLibre GL JS v3 removed those, and a single legacy filter makes it drop the
// whole style with no error event, which reads exactly like a blank map.
// (earth, landcover, landuse, water, boundaries, roads, buildings, places, pois)
// rather than pulled from a theme package — it's ~60 lines this way, and it has
// to match Draught's palette, which no off-the-shelf theme does.
//
// Everything is served from our own origin: the archive from R2 via
// /api/tiles/*, the glyphs from /assets/fonts. No external host is contacted, so
// panning the map is not visible to anyone but us.

const C = {
  earth: '#241d16',
  land: '#2a231b',
  water: '#12100c',
  road: '#3a3025',
  roadMajor: '#4a3d2d',
  boundary: '#453a2b',
  building: '#312819',
  text: '#c8bda9',
  halo: '#0e0c09',
};

export function style(archive) {
  return {
    version: 8,
    glyphs: '/assets/fonts/{fontstack}/{range}.pbf',
    sources: {
      base: {
        type: 'vector',
        url: `pmtiles:///api/tiles/${archive}`,
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>, <a href="https://protomaps.com">Protomaps</a>',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': C.water } },
      { id: 'earth', type: 'fill', source: 'base', 'source-layer': 'earth',
        paint: { 'fill-color': C.earth } },
      { id: 'landcover', type: 'fill', source: 'base', 'source-layer': 'landcover',
        paint: { 'fill-color': C.land, 'fill-opacity': 0.5 } },
      { id: 'landuse', type: 'fill', source: 'base', 'source-layer': 'landuse',
        paint: { 'fill-color': C.land, 'fill-opacity': 0.6 } },
      { id: 'water', type: 'fill', source: 'base', 'source-layer': 'water',
        paint: { 'fill-color': C.water } },
      { id: 'buildings', type: 'fill', source: 'base', 'source-layer': 'buildings',
        minzoom: 13, paint: { 'fill-color': C.building, 'fill-opacity': 0.8 } },
      { id: 'roads-minor', type: 'line', source: 'base', 'source-layer': 'roads',
        filter: ['!', ['in', ['get', 'kind'], ['literal', ['highway', 'major_road']]]],
        paint: { 'line-color': C.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 16, 3] } },
      { id: 'roads-major', type: 'line', source: 'base', 'source-layer': 'roads',
        filter: ['in', ['get', 'kind'], ['literal', ['highway', 'major_road']]],
        paint: { 'line-color': C.roadMajor, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 16, 5] } },
      { id: 'boundaries', type: 'line', source: 'base', 'source-layer': 'boundaries',
        paint: { 'line-color': C.boundary, 'line-width': 0.7, 'line-dasharray': [3, 2] } },
      // One label layer, one font — every extra fontstack is another set of
      // glyph files to host.
      { id: 'places', type: 'symbol', source: 'base', 'source-layer': 'places',
        filter: ['in', ['get', 'kind'], ['literal', ['country', 'region', 'locality']]],
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 13, 14, 16],
          'text-max-width': 8,
        },
        paint: { 'text-color': C.text, 'text-halo-color': C.halo, 'text-halo-width': 1.4 } },
    ],
  };
}
