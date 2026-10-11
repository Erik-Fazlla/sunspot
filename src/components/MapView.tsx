import { useEffect, useRef, useState } from 'react'
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
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
  MAX_SHADOW_BUILDINGS,
  MAX_SHADOW_LENGTH_M,
  MIN_SHADOW_ZOOM,
  MOVE_DEBOUNCE_MS,
} from '../lib/constants'
import {
  buildingsFromFeatures,
  metersToDegrees,
  shadowOffset,
  shadowRenderGeometry,
  type Building,
} from '../lib/shadow'
import { getSunPosition } from '../lib/sun'

// Vite pre-bundles maplibre-gl, so its "worker next to the module" lookup
// would miss. Point it at a worker bundle Vite builds for us.
setWorkerUrl(workerUrl)

const SHADOW_SOURCE = 'sunspot-shadows'
const SHADOW_LAYER = 'sunspot-shadows'
const SUNLIGHT_SOURCE = 'sunspot-sunlight'
const SUNLIGHT_LAYER = 'sunspot-sunlight'
/** Overlay strength under a clear sky. */
const SUNLIGHT_OPACITY = 0.3
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
/** Shadow darkness under a clear sky. */
const SHADOW_OPACITY = 0.42
/** Under full cloud a faint shadow stays, so the geometry remains readable. */
const MIN_SHADOW_SHARE = 0.25

function shadowOpacity(sunFactor: number): number {
  return SHADOW_OPACITY * (MIN_SHADOW_SHARE + (1 - MIN_SHADOW_SHARE) * sunFactor)
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
  point: LngLat | null
  onPointSelect: (point: LngLat) => void
  /** Called with every building in the loaded tiles whenever that set changes. */
  onBuildingsChange: (buildings: Building[]) => void
}

export function MapView({
  center,
  sunTime,
  sunFactor,
  showSunlight,
  point,
  onPointSelect,
  onBuildingsChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const buildingsRef = useRef<Building[]>([])
  const signatureRef = useRef('')
  const drawRef = useRef<() => void>(() => {})
  const callbacksRef = useRef({ onPointSelect, onBuildingsChange })
  const [hint, setHint] = useState<Hint>(null)
  const [ready, setReady] = useState(false)
  const appearanceRef = useRef({ sunFactor })

  useEffect(() => {
    callbacksRef.current = { onPointSelect, onBuildingsChange }
  })

  // Redraws the shadow layer for the current view and `sunTime`.
  useEffect(() => {
    drawRef.current = () => {
      const map = mapRef.current
      const source = map?.getSource<GeoJSONSource>(SHADOW_SOURCE)
      if (!map || !source) return
      const mapCenter = map.getCenter()
      // The sun's direction is effectively the same across one viewport.
      const sun = getSunPosition(sunTime, mapCenter.lat, mapCenter.lng)
      if (map.getZoom() < MIN_SHADOW_ZOOM || sun.altitudeRad <= 0) {
        source.setData(EMPTY)
        setHint(sun.altitudeRad <= 0 ? 'night' : 'zoom')
        return
      }

      // Buildings just outside the view can still throw shadows into it.
      const bounds = map.getBounds()
      const margin = metersToDegrees(MAX_SHADOW_LENGTH_M, MAX_SHADOW_LENGTH_M, mapCenter.lat)
      const west = bounds.getWest() - margin.dLon
      const east = bounds.getEast() + margin.dLon
      const south = bounds.getSouth() - margin.dLat
      const north = bounds.getNorth() + margin.dLat
      let visible = buildingsRef.current.filter(
        ({ bbox }) => bbox[2] >= west && bbox[0] <= east && bbox[3] >= south && bbox[1] <= north,
      )
      // Busy views: shade the buildings nearest the centre and skip the rest.
      if (visible.length > MAX_SHADOW_BUILDINGS) {
        const distance = ({ bbox }: Building) =>
          (bbox[0] - mapCenter.lng) ** 2 + (bbox[1] - mapCenter.lat) ** 2
        visible = visible.sort((a, b) => distance(a) - distance(b)).slice(0, MAX_SHADOW_BUILDINGS)
      }

      const features: Feature[] = []
      for (const building of visible) {
        const offset = shadowOffset(building.height, sun, mapCenter.lat)
        if (!offset) continue
        features.push({ type: 'Feature', properties: {}, geometry: shadowRenderGeometry(building, offset) })
      }
      source.setData({ type: 'FeatureCollection', features })
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
      maxPitch: 70,
      attributionControl: false,
    })
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
          paint: { 'fill-color': '#ffdf6b', 'fill-opacity': 0 },
        },
        // Below the shadows, so shaded ground is covered by them.
        SHADOW_LAYER,
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
    const visible = showSunlight && hint === null
    map.setPaintProperty(SUNLIGHT_LAYER, 'fill-opacity', visible ? SUNLIGHT_OPACITY * sunFactor : 0)
  }, [ready, showSunlight, sunFactor, hint])

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
