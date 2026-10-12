// Restyles the OpenFreeMap "liberty" style into a quiet backdrop, so that the
// shadows and the sun-hours map are what the eye lands on. Everything here
// is a paint, layout or filter override applied after the style loads; the
// tiles and the style URL stay the same.

/** The slice of a style layer this module needs. */
export interface BasemapLayer {
  id: string
  type: string
  'source-layer'?: string
}

export type BasemapChange =
  | { kind: 'hide'; id: string }
  | { kind: 'paint'; id: string; property: string; value: unknown }
  | { kind: 'layout'; id: string; property: string; value: unknown }
  | { kind: 'filter'; id: string; value: unknown }

const LABEL_HALO = '#fbfaf7'

/** Neutral, slightly warm fills for land and water. */
const FILL_COLORS: Record<string, string> = {
  park: '#e3e8dc',
  landuse_residential: '#f1eee9',
  landcover_wood: '#dfe5d8',
  landcover_grass: '#e5e9df',
  landcover_wetland: '#e2e8e4',
  landcover_sand: '#efebe1',
  landcover_ice: '#f5f6f6',
  landuse_pitch: '#e4e8dd',
  landuse_track: '#e8e8e0',
  landuse_cemetery: '#e4e7de',
  landuse_hospital: '#f0ebe9',
  landuse_school: '#eeece4',
  aeroway_fill: '#eceae6',
  water: '#d3dee7',
  building: '#e9e5de',
}

const ROAD = { fill: '#ffffff', casing: '#e6e2dc' }
const MAJOR_ROAD = { fill: '#fbf8f2', casing: '#dcd6cc' }
const RAIL = '#d8d4ce'

/**
 * Work out the overrides for a list of style layers. Pure, so the rules can
 * be read (and tested) without a map.
 */
export function cleanBasemapChanges(layers: BasemapLayer[], onImagery = false): BasemapChange[] {
  const changes: BasemapChange[] = []
  // Over a satellite photo, pale grey text would vanish: labels turn white with a dark halo.
  const label = onImagery
    ? { street: '#ffffff', place: '#ffffff', transit: '#e8eef6', water: '#dbe8f5', halo: 'rgba(14, 18, 30, 0.85)' }
    : { street: '#a6a099', place: '#7f7a73', transit: '#8b97a3', water: '#9fb2c2', halo: LABEL_HALO }
  const paint = (id: string, property: string, value: unknown) =>
    changes.push({ kind: 'paint', id, property, value })
  const layout = (id: string, property: string, value: unknown) =>
    changes.push({ kind: 'layout', id, property, value })

  for (const layer of layers) {
    const { id, type } = layer
    const sourceLayer = layer['source-layer']

    if (type === 'background') {
      paint(id, 'background-color', '#f4f1ec')
      continue
    }

    if (type === 'fill') {
      if (id in FILL_COLORS) {
        paint(id, 'fill-color', FILL_COLORS[id])
        if (id === 'park' || id === 'building') paint(id, 'fill-outline-color', 'rgba(0,0,0,0)')
      }
      // The hatched pedestrian-area pattern is busy; keep a trace of it.
      if (id === 'road_area_pattern') paint(id, 'fill-opacity', 0.35)
      continue
    }

    if (type === 'line') {
      if (id === 'park_outline') changes.push({ kind: 'hide', id })
      else if (sourceLayer === 'waterway') paint(id, 'line-color', '#c9d6e0')
      else if (sourceLayer === 'transportation') {
        if (id.includes('rail')) paint(id, 'line-color', RAIL)
        else {
          const major = /motorway|trunk|primary|secondary|tertiary/.test(id)
          const palette = major ? MAJOR_ROAD : ROAD
          paint(id, 'line-color', id.endsWith('_casing') ? palette.casing : palette.fill)
        }
      } else if (sourceLayer === 'boundary') paint(id, 'line-color', '#cfc9c4')
      continue
    }

    if (type !== 'symbol') continue

    if (sourceLayer === 'poi') {
      if (id === 'poi_transit') {
        // Bus stops crowd a city centre; rail and metro stations are useful landmarks.
        changes.push({ kind: 'filter', id, value: ['match', ['get', 'class'], ['rail'], true, false] })
        layout(id, 'icon-size', 0.55)
        layout(id, 'text-size', 10)
        paint(id, 'text-color', label.transit)
        paint(id, 'text-halo-color', label.halo)
        paint(id, 'icon-opacity', 0.75)
      } else {
        // Shops, restaurants, offices and every other point of interest.
        changes.push({ kind: 'hide', id })
      }
      continue
    }

    if (sourceLayer === 'aerodrome_label' || id.startsWith('road_one_way') || id.includes('shield')) {
      changes.push({ kind: 'hide', id })
      continue
    }

    if (sourceLayer === 'transportation_name') {
      // Street names stay, small and low-contrast.
      layout(id, 'text-size', ['interpolate', ['linear'], ['zoom'], 13, 9, 16, 10.5, 19, 12])
      paint(id, 'text-color', label.street)
      paint(id, 'text-halo-color', label.halo)
      paint(id, 'text-halo-width', 1.2)
      continue
    }

    if (sourceLayer === 'place') {
      paint(id, 'text-color', label.place)
      paint(id, 'text-halo-color', label.halo)
      layout(id, 'icon-image', '')
      continue
    }

    if (sourceLayer === 'water_name' || sourceLayer === 'waterway') {
      paint(id, 'text-color', label.water)
      paint(id, 'text-halo-color', label.halo)
    }
  }
  return changes
}

/** The parts of a MapLibre map that `applyCleanBasemap` uses. */
interface StyleTarget {
  getStyle(): { layers: BasemapLayer[] }
  getLayer(id: string): unknown
  setLayoutProperty(id: string, property: string, value: unknown): unknown
  setPaintProperty(id: string, property: string, value: unknown): unknown
  setFilter(id: string, filter: never): unknown
}

export function applyCleanBasemap(map: StyleTarget, onImagery = false): void {
  for (const change of cleanBasemapChanges(map.getStyle().layers, onImagery)) {
    if (!map.getLayer(change.id)) continue
    try {
      if (change.kind === 'hide') map.setLayoutProperty(change.id, 'visibility', 'none')
      else if (change.kind === 'paint') map.setPaintProperty(change.id, change.property, change.value)
      else if (change.kind === 'layout') map.setLayoutProperty(change.id, change.property, change.value)
      else map.setFilter(change.id, change.value as never)
    } catch (error) {
      // A style update upstream must not take the map down with it.
      console.warn('[basemap] skipped', change.id, error)
    }
  }
}
