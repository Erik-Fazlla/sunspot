import { useEffect, useRef, useState } from 'react'
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type SkySpecification,
} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection } from 'geojson'
import {
  BUILDING_3D_LAYER,
  BUILDING_SOURCE,
  BUILDING_SOURCE_LAYER,
  DEFAULT_PITCH,
  DEFAULT_ZOOM,
  MAP_STYLE_URL,
  MAX_PITCH,
  MAX_SHADOW_BUILDINGS,
  MAX_SHADOW_LENGTH_M,
  MIN_SHADOW_ZOOM,
  MOVE_DEBOUNCE_MS,
  TERRAIN_ATTRIBUTION,
  TERRAIN_EXAGGERATION,
  TERRAIN_MAX_ZOOM,
  TERRAIN_TILES_URL,
} from '../lib/constants'
import type { MapViewState } from '../hooks/useStreetFurniture'
import { applyCleanBasemap } from '../lib/basemap'
import {
  BENCH_COLORS,
  benchFeatures,
  benchStates,
  castersNearBenches,
  furnitureFeatures,
  type BenchState,
} from '../lib/furniture'
import type { StreetFurniture } from '../lib/overpass'
import { shadowOpacity, SUNLIGHT_COLOR, sunlightOpacity } from '../lib/overlay'
import {
  buildingsFromFeatures,
  metersToDegrees,
  shadowOffset,
  shadowRenderGeometry,
  shadowSweep,
  type Building,
} from '../lib/shadow'
import { getSunPosition, type SunPosition } from '../lib/sun'

// Vite pre-bundles maplibre-gl, so its "worker next to the module" lookup
// would miss. Point it at a worker bundle Vite builds for us.
setWorkerUrl(workerUrl)

const SHADOW_SOURCE = 'sunspot-shadows'
const SHADOW_LAYER = 'sunspot-shadows'
const SUNLIGHT_SOURCE = 'sunspot-sunlight'
const SUNLIGHT_LAYER = 'sunspot-sunlight'
// One polygon over the whole map. The shadow layer above it darkens the shaded
// parts, so the warm tint only reads as sunlit ground and no union is needed.
const WORLD: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]],
      },
    },
  ],
}
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

// Trees and lamps are extruded shapes; benches are flat dots coloured by sun or shade.
const FURNITURE_SOURCE = 'sunspot-furniture'
const FURNITURE_LAYER = 'sunspot-furniture'
const BENCH_SOURCE = 'sunspot-benches'
const BENCH_LAYER = 'sunspot-benches'
const STREET_DETAILS_ATTRIBUTION =
  'Street details © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> (ODbL)'

// Elevation is loaded twice on purpose: MapLibre advises separate sources for
// the 3D terrain mesh and the hillshade layer.
const TERRAIN_SOURCE = 'sunspot-terrain'
const HILLSHADE_SOURCE = 'sunspot-hillshade-dem'
const HILLSHADE_LAYER = 'sunspot-hillshade'
/** Hillshade goes under water and roads; this is the first such layer in the style. */
const HILLSHADE_BEFORE = 'waterway_tunnel'
const SHADOW_LIFT_ON_TERRAIN_M = 1.5

/** Keeps roofs readable at sunrise and sunset, when a true sun angle would leave them dark. */
const MAX_LIGHT_POLAR_DEG = 55

type SkyPhase = 'day' | 'golden' | 'night'

const SKY: Record<SkyPhase, SkySpecification> = {
  day: { 'sky-color': '#74b0ea', 'horizon-color': '#dcecf9', 'fog-color': '#eef3f6' },
  golden: { 'sky-color': '#6f8fc4', 'horizon-color': '#f9cf96', 'fog-color': '#f6e3c8' },
  night: { 'sky-color': '#0b1230', 'horizon-color': '#2a3358', 'fog-color': '#1c2444' },
}
const SKY_BLEND: SkySpecification = {
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.7,
  'fog-ground-blend': 0.5,
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0],
}

function skyPhase(sun: SunPosition): SkyPhase {
  if (sun.altitudeDeg <= 0) return 'night'
  return sun.altitudeDeg < 8 ? 'golden' : 'day'
}

export interface LngLat {
  lat: number
  lon: number
}

type Hint = 'zoom' | 'night' | null

const HINT_TEXT: Record<Exclude<Hint, null>, string> = {
  zoom: 'Zoom in to see building shadows',
  night: 'The sun is below the horizon at this time',
}

interface Props {
  center: LngLat
  /** The instant whose shadows are drawn. */
  sunTime: Date
  /** 0 to 1: how much direct sun the weather lets through. Fades the shadows under cloud. */
  sunFactor: number
  /** Tint sunlit ground with a warm overlay. */
  showSunlight: boolean
  /** 3D terrain and hillshade from free elevation tiles. */
  showTerrain: boolean
  /** Benches, trees and lamps to draw; null hides them. */
  furniture: StreetFurniture | null
  /** The trees of `furniture` as shadow casters (see lib/furniture.ts). */
  treeCasters: Building[]
  point: LngLat | null
  onPointSelect: (point: LngLat) => void
  /** Called with every building in the loaded tiles whenever that set changes. */
  onBuildingsChange: (buildings: Building[]) => void
  /** Called after the map settles on a new view. */
  onViewChange: (view: MapViewState) => void
}

export function MapView({
  center,
  sunTime,
  sunFactor,
  showSunlight,
  showTerrain,
  furniture,
  treeCasters,
  point,
  onPointSelect,
  onBuildingsChange,
  onViewChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const buildingsRef = useRef<Building[]>([])
  const visibleRef = useRef<Building[]>([])
  const signatureRef = useRef('')
  const drawRef = useRef<() => void>(() => {})
  const callbacksRef = useRef({ onPointSelect, onBuildingsChange, onViewChange })
  const viewSignatureRef = useRef('')
  // Street furniture as the draw loop needs it; `benchCasters[i]` are the casters near bench i.
  const streetRef = useRef<{ benches: StreetFurniture['benches']; treeCasters: Building[]; benchCasters: Building[][] }>({
    benches: [],
    treeCasters: [],
    benchCasters: [],
  })
  const linkBenchesRef = useRef<() => void>(() => {})
  const benchSignatureRef = useRef('')
  const [hint, setHint] = useState<Hint>(null)
  const [ready, setReady] = useState(false)
  const appearanceRef = useRef({ sunFactor })
  const skyPhaseRef = useRef<SkyPhase | null>(null)

  useEffect(() => {
    callbacksRef.current = { onPointSelect, onBuildingsChange, onViewChange }
  })

  // Pairs each bench with the buildings and trees close enough to shade it.
  // Done when the view or the furniture changes, not on every slider step.
  useEffect(() => {
    linkBenchesRef.current = () => {
      const street = streetRef.current
      street.benchCasters = castersNearBenches(
        street.benches,
        [...visibleRef.current, ...street.treeCasters],
        MAX_SHADOW_LENGTH_M,
      )
    }
  }, [])

  // Redraws the shadow layer for the current view and `sunTime`.
  useEffect(() => {
    drawRef.current = () => {
      const map = mapRef.current
      const source = map?.getSource<GeoJSONSource>(SHADOW_SOURCE)
      if (!map || !source) return
      const mapCenter = map.getCenter()
      // The sun's direction is effectively the same across one viewport.
      const sun = getSunPosition(sunTime, mapCenter.lat, mapCenter.lng)
      // Light the scene from where the sun actually is: walls facing it are
      // bright, the sky follows the time of day and the hills are shaded to match.
      const up = sun.altitudeRad > 0
      const phase = skyPhase(sun)
      map.setLight({
        anchor: 'map',
        position: [1.5, up ? sun.bearingDeg : 210, up ? Math.min(MAX_LIGHT_POLAR_DEG, 90 - sun.altitudeDeg) : 40],
        intensity: up ? 0.55 : 0.15,
        // Low sun is warm; high sun is white.
        color: phase === 'golden' ? '#fff0da' : '#ffffff',
      })
      if (phase !== skyPhaseRef.current) {
        skyPhaseRef.current = phase
        map.setSky({ ...SKY_BLEND, ...SKY[phase] })
      }
      if (map.getLayer(HILLSHADE_LAYER)) {
        // Hillshade is drawn into the terrain texture, which is costly to repaint,
        // so its light only moves in 10-degree steps rather than on every slider step.
        const direction = up ? Math.round(sun.bearingDeg / 10) * 10 : 315
        if (map.getPaintProperty(HILLSHADE_LAYER, 'hillshade-illumination-direction') !== direction) {
          map.setPaintProperty(HILLSHADE_LAYER, 'hillshade-illumination-direction', direction)
        }
      }

      const street = streetRef.current
      const benchSource = map.getSource<GeoJSONSource>(BENCH_SOURCE)
      // Bench colours rarely change from one slider step to the next; skip the update when they have not.
      const paintBenches = (states: BenchState[]) => {
        const signature = `${street.benches.length}:${states.join('')}`
        if (signature === benchSignatureRef.current) return
        benchSignatureRef.current = signature
        benchSource?.setData(benchFeatures(street.benches, states))
      }

      if (map.getZoom() < MIN_SHADOW_ZOOM || sun.altitudeRad <= 0) {
        source.setData(EMPTY)
        paintBenches(street.benches.map(() => (up ? 'unknown' : 'night')))
        setHint(sun.altitudeRad <= 0 ? 'night' : 'zoom')
        return
      }

      const features: Feature[] = []
      for (const building of visibleRef.current) {
        const offset = shadowOffset(building.height, sun, mapCenter.lat)
        if (!offset) continue
        features.push({ type: 'Feature', properties: {}, geometry: shadowRenderGeometry(building, offset) })
      }
      // Trees go through the same pipeline: a canopy is a footprint that floats above the ground.
      for (const tree of street.treeCasters) {
        const sweep = shadowSweep(tree, sun, mapCenter.lat)
        if (!sweep) continue
        features.push({ type: 'Feature', properties: {}, geometry: shadowRenderGeometry(sweep, sweep.offset) })
      }
      source.setData({ type: 'FeatureCollection', features })
      paintBenches(benchStates(street.benches, street.benchCasters, sun))
      setHint(null)
    }
    drawRef.current()
  }, [sunTime])

  useEffect(() => {
    const compact = window.matchMedia('(max-width: 720px)').matches
    const map = new MapLibreMap({
      container: containerRef.current!,
      style: MAP_STYLE_URL,
      center: [center.lon, center.lat],
      zoom: DEFAULT_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: -18,
      maxPitch: MAX_PITCH,
      // Render at the real screen resolution so lines and labels stay sharp on HiDPI displays.
      pixelRatio: window.devicePixelRatio,
      attributionControl: false,
    })
    // The ratio changes when the window moves to another screen or the page is zoomed.
    let ratioQuery: MediaQueryList | null = null
    const onRatioChange = () => {
      map.setPixelRatio(window.devicePixelRatio)
      watchRatio()
    }
    const watchRatio = () => {
      ratioQuery?.removeEventListener('change', onRatioChange)
      ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      ratioQuery.addEventListener('change', onRatioChange)
    }
    watchRatio()

    // Keep the canvas the size of its container. MapLibre tracks resizes itself,
    // but can lag a step behind; a stale canvas shows up as an empty strip at an edge.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const resizeMap = () => {
      map.resize()
      // Mobile browsers settle their toolbars a moment after the event.
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => map.resize(), 200)
    }
    const resizeObserver = new ResizeObserver(resizeMap)
    resizeObserver.observe(containerRef.current!)
    window.addEventListener('resize', resizeMap)
    window.addEventListener('orientationchange', resizeMap)
    window.visualViewport?.addEventListener('resize', resizeMap)

    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: 'Weather: <a href="https://open-meteo.com" target="_blank" rel="noreferrer">Open-Meteo</a>',
      }),
      // The bottom sheet covers the bottom edge on phones.
      compact ? 'top-left' : 'bottom-right',
    )
    map.on('error', (e) => console.error('[map]', e.error?.message ?? e))
    if (import.meta.env.DEV) (window as unknown as { __map?: MapLibreMap }).__map = map
    mapRef.current = map

    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      const buildings =
        map.getZoom() >= MIN_SHADOW_ZOOM - 1
          ? buildingsFromFeatures(
              map.querySourceFeatures(BUILDING_SOURCE, { sourceLayer: BUILDING_SOURCE_LAYER }),
            )
          : []
      buildingsRef.current = buildings

      // Which buildings to shade depends only on the view, not on the time, so
      // it is worked out here (after a move) rather than on every slider step.
      const mapCenter = map.getCenter()
      // Buildings just outside the view can still throw shadows into it.
      const bounds = map.getBounds()
      const margin = metersToDegrees(MAX_SHADOW_LENGTH_M, MAX_SHADOW_LENGTH_M, mapCenter.lat)
      const west = bounds.getWest() - margin.dLon
      const east = bounds.getEast() + margin.dLon
      const south = bounds.getSouth() - margin.dLat
      const north = bounds.getNorth() + margin.dLat
      let visible = buildings.filter(
        ({ bbox }) => bbox[2] >= west && bbox[0] <= east && bbox[3] >= south && bbox[1] <= north,
      )
      // Busy views: shade the buildings nearest the centre and skip the rest.
      if (visible.length > MAX_SHADOW_BUILDINGS) {
        const distance = ({ bbox }: Building) =>
          (bbox[0] - mapCenter.lng) ** 2 + (bbox[1] - mapCenter.lat) ** 2
        visible = visible.sort((a, b) => distance(a) - distance(b)).slice(0, MAX_SHADOW_BUILDINGS)
      }
      visibleRef.current = visible
      linkBenchesRef.current()

      // Report the view, but only when it has really changed.
      const view: MapViewState = {
        zoom: map.getZoom(),
        bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        center: [mapCenter.lng, mapCenter.lat],
      }
      const viewSignature = `${view.zoom.toFixed(1)}:${view.bounds.map((value) => value.toFixed(4)).join(',')}`
      if (viewSignature !== viewSignatureRef.current) {
        viewSignatureRef.current = viewSignature
        callbacksRef.current.onViewChange(view)
      }
      // Tile loads fire often; only tell React when the set really changed.
      const first = buildings[0]?.bbox[0] ?? 0
      const last = buildings[buildings.length - 1]?.bbox[0] ?? 0
      const signature = `${buildings.length}:${first}:${last}`
      if (signature !== signatureRef.current) {
        signatureRef.current = signature
        callbacksRef.current.onBuildingsChange(buildings)
      }
      drawRef.current()
    }
    const scheduleRefresh = () => {
      clearTimeout(timer)
      timer = setTimeout(refresh, MOVE_DEBOUNCE_MS)
    }

    map.on('load', () => {
      applyCleanBasemap(map as unknown as Parameters<typeof applyCleanBasemap>[0])
      map.addSource(SHADOW_SOURCE, { type: 'geojson', data: EMPTY })
      map.addLayer(
        {
          id: SHADOW_LAYER,
          // A zero-height extrusion rather than a plain fill: translucent
          // extrusions paint each pixel once, so overlapping shadows do not
          // stack into darker patches and no polygon union is needed per frame.
          type: 'fill-extrusion',
          source: SHADOW_SOURCE,
          paint: {
            'fill-extrusion-color': '#141b38',
            'fill-extrusion-opacity': shadowOpacity(appearanceRef.current.sunFactor),
            'fill-extrusion-height': 0,
            'fill-extrusion-base': 0,
            'fill-extrusion-vertical-gradient': false,
          },
        },
        map.getLayer(BUILDING_3D_LAYER) ? BUILDING_3D_LAYER : undefined,
      )
      map.addSource(SUNLIGHT_SOURCE, { type: 'geojson', data: WORLD })
      map.addLayer(
        {
          id: SUNLIGHT_LAYER,
          type: 'fill',
          source: SUNLIGHT_SOURCE,
          paint: { 'fill-color': SUNLIGHT_COLOR, 'fill-opacity': 0 },
        },
        // Below the shadows, so shaded ground is covered by them.
        SHADOW_LAYER,
      )
      // Trees and lamps stand among the buildings, below the labels.
      const layerIds = map.getStyle().layers.map((layer) => layer.id)
      const aboveBuildings = layerIds[layerIds.indexOf(BUILDING_3D_LAYER) + 1]
      map.addSource(FURNITURE_SOURCE, { type: 'geojson', data: EMPTY, attribution: STREET_DETAILS_ATTRIBUTION })
      map.addLayer(
        {
          id: FURNITURE_LAYER,
          type: 'fill-extrusion',
          source: FURNITURE_SOURCE,
          paint: {
            'fill-extrusion-color': ['get', 'color'],
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'base'],
            'fill-extrusion-opacity': 1,
          },
        },
        aboveBuildings,
      )
      map.addSource(BENCH_SOURCE, { type: 'geojson', data: EMPTY })
      map.addLayer(
        {
          id: BENCH_LAYER,
          type: 'circle',
          source: BENCH_SOURCE,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2.5, 17, 5, 19, 8],
            'circle-color': [
              'match',
              ['get', 'state'],
              'sun',
              BENCH_COLORS.sun,
              'shade',
              BENCH_COLORS.shade,
              'night',
              BENCH_COLORS.night,
              BENCH_COLORS.unknown,
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
            'circle-pitch-alignment': 'map',
          },
        },
        aboveBuildings,
      )
      if (map.getLayer(BUILDING_3D_LAYER)) {
        // Near-opaque walls keep the shadow under a footprint from tinting the building itself.
        map.setPaintProperty(BUILDING_3D_LAYER, 'fill-extrusion-opacity', 0.94)
        map.setPaintProperty(BUILDING_3D_LAYER, 'fill-extrusion-color', '#efeae0')
      }
      setReady(true)
      refresh()
    })
    map.on('moveend', scheduleRefresh)
    map.on('sourcedata', (event) => {
      if (event.sourceId === BUILDING_SOURCE && map.isSourceLoaded(BUILDING_SOURCE)) scheduleRefresh()
    })
    map.on('click', (event) => {
      callbacksRef.current.onPointSelect({ lat: event.lngLat.lat, lon: event.lngLat.lng })
    })

    return () => {
      clearTimeout(timer)
      clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      window.removeEventListener('resize', resizeMap)
      window.removeEventListener('orientationchange', resizeMap)
      window.visualViewport?.removeEventListener('resize', resizeMap)
      ratioQuery?.removeEventListener('change', onRatioChange)
      map.remove()
      mapRef.current = null
    }
    // The map is created once; later centre changes fly instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clouds weaken the direct beam, so shadows fade with the sunFactor.
  useEffect(() => {
    appearanceRef.current = { sunFactor }
    const map = mapRef.current
    if (!ready || !map?.getLayer(SHADOW_LAYER)) return
    map.setPaintProperty(SHADOW_LAYER, 'fill-extrusion-opacity', shadowOpacity(sunFactor))
  }, [ready, sunFactor])

  // The sunlight tint follows the same rule, and only shows where shadows are
  // drawn too: without them the whole map would wrongly look sunlit.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map?.getLayer(SUNLIGHT_LAYER)) return
    // `hint` is null exactly when the sun is up and shadows are being drawn.
    const opacity = showSunlight ? sunlightOpacity(sunFactor, hint === null) : 0
    map.setPaintProperty(SUNLIGHT_LAYER, 'fill-opacity', opacity)
  }, [ready, showSunlight, sunFactor, hint])

  // Street furniture: redraw the 3D shapes and re-link benches when the data changes.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.getSource<GeoJSONSource>(FURNITURE_SOURCE)?.setData(furniture ? furnitureFeatures(furniture) : EMPTY)
    streetRef.current = { benches: furniture?.benches ?? [], treeCasters, benchCasters: [] }
    benchSignatureRef.current = ''
    linkBenchesRef.current()
    drawRef.current()
  }, [ready, furniture, treeCasters])

  // Terrain is optional: its tiles are only requested once it is switched on.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (showTerrain) {
      if (!map.getSource(TERRAIN_SOURCE)) {
        const dem = {
          type: 'raster-dem' as const,
          tiles: [TERRAIN_TILES_URL],
          tileSize: 256,
          maxzoom: TERRAIN_MAX_ZOOM,
          encoding: 'terrarium' as const,
          attribution: TERRAIN_ATTRIBUTION,
        }
        map.addSource(TERRAIN_SOURCE, dem)
        map.addSource(HILLSHADE_SOURCE, dem)
        map.addLayer(
          {
            id: HILLSHADE_LAYER,
            type: 'hillshade',
            source: HILLSHADE_SOURCE,
            paint: {
              'hillshade-exaggeration': 0.65,
              'hillshade-shadow-color': '#39456b',
              'hillshade-highlight-color': '#fff6dc',
              'hillshade-illumination-anchor': 'map',
            },
          },
          map.getLayer(HILLSHADE_BEFORE) ? HILLSHADE_BEFORE : undefined,
        )
      }
      map.setLayoutProperty(HILLSHADE_LAYER, 'visibility', 'visible')
      map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: TERRAIN_EXAGGERATION })
      // Lifted a little so the terrain surface does not hide the flat shadows.
      map.setPaintProperty(SHADOW_LAYER, 'fill-extrusion-height', SHADOW_LIFT_ON_TERRAIN_M)
      drawRef.current()
    } else if (map.getSource(TERRAIN_SOURCE)) {
      map.setTerrain(null)
      map.setPaintProperty(SHADOW_LAYER, 'fill-extrusion-height', 0)
      map.setLayoutProperty(HILLSHADE_LAYER, 'visibility', 'none')
    }
  }, [ready, showTerrain])

  useEffect(() => {
    mapRef.current?.flyTo({ center: [center.lon, center.lat], zoom: DEFAULT_ZOOM, duration: 1400 })
  }, [center.lat, center.lon])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!point) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }
    if (!markerRef.current) {
      const element = document.createElement('div')
      element.className = 'pin'
      markerRef.current = new Marker({ element }).setLngLat([point.lon, point.lat]).addTo(map)
    } else {
      markerRef.current.setLngLat([point.lon, point.lat])
    }
  }, [point])

  return (
    <>
      <div ref={containerRef} className="map" aria-label="3D map" />
      <div className={`map-dim${hint === 'night' ? ' is-night' : ''}`} />
      {hint && (
        <div className="map-hint" role="status">
          {HINT_TEXT[hint]}
        </div>
      )}
    </>
  )
}
