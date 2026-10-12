import { useEffect, useRef, useState } from 'react'
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type CanvasSource,
  type SkySpecification,
} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection } from 'geojson'
import { applyCleanBasemap } from '../lib/basemap'
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
import { ESRI_ATTRIBUTION, esriImageryTileUrl, IMAGERY_MAX_ZOOM, imageryTone } from '../lib/imagery'
import { SHADE_OPACITY, SUNLIGHT_COLOR, sunlightOpacity } from '../lib/overlay'
import {
  buildingsFromFeatures,
  metersToDegrees,
  shadowOffset,
  shadowRibbons,
  type Building,
  type Ring,
} from '../lib/shadow'
import {
  extentCorners,
  paintShadows,
  SHADE_FILL,
  SHADOW_CANVAS_PX,
  shadowExtent,
  type ShadowExtent,
} from '../lib/shadowCanvas'
import { getSunPosition, type SunPosition } from '../lib/sun'
import { sunDirectionLabel, sunIndicatorPosition } from '../lib/sunIndicator'

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

const IMAGERY_SOURCE = 'sunspot-imagery'
const IMAGERY_LAYER = 'sunspot-imagery'
/** Near-opaque walls keep the shadow under a footprint from tinting the building itself. */
const BUILDING_OPACITY_ON_MAP = 0.94
/** Over a photo the 3D buildings turn into faint glass boxes, so the real roofs show through. */
const BUILDING_OPACITY_ON_IMAGERY = 0.28

// Elevation is loaded twice on purpose: MapLibre advises separate sources for
// the 3D terrain mesh and the hillshade layer.
const TERRAIN_SOURCE = 'sunspot-terrain'
const HILLSHADE_SOURCE = 'sunspot-hillshade-dem'
const HILLSHADE_LAYER = 'sunspot-hillshade'
/** Hillshade goes under water and roads; this is the first such layer in the style. */
const HILLSHADE_BEFORE = 'waterway_tunnel'

/** Keeps roofs readable at sunrise and sunset, when a true sun angle would leave them dark. */
const MAX_LIGHT_POLAR_DEG = 55
/** Width the control panel takes on wide screens; the sun indicator stays clear of it. */
const PANEL_WIDTH_PX = 404

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

export type Basemap = 'map' | 'satellite'

type Hint = 'zoom' | 'night' | null

const HINT_TEXT: Record<Exclude<Hint, null>, string> = {
  zoom: 'Zoom in to see building shadows',
  night: 'The sun is below the horizon at this time',
}

interface Props {
  center: LngLat
  /** The instant whose shadows are drawn. */
  sunTime: Date
  /** 0 to 1: how much direct sun the weather lets through; null without a forecast. */
  sunStrength: number | null
  /** The drawn map, or a satellite photo under the shadows. */
  basemap: Basemap
  /** Opacity of the satellite photo, 0 to 1. */
  imageryOpacity: number
  /** Show where the sunlight comes from. */
  showSunDirection: boolean
  /** Tint sunlit ground with a warm overlay. */
  showSunlight: boolean
  /** 3D terrain and hillshade from free elevation tiles. */
  showTerrain: boolean
  /** Clock time the shade is drawn for, e.g. "16:00"; shown in the map legend. */
  shadeTimeLabel: string
  point: LngLat | null
  onPointSelect: (point: LngLat) => void
  /** Called with every building in the loaded tiles whenever that set changes. */
  onBuildingsChange: (buildings: Building[]) => void
}

export function MapView({
  center,
  sunTime,
  sunStrength,
  basemap,
  imageryOpacity,
  showSunDirection,
  showSunlight,
  showTerrain,
  shadeTimeLabel,
  point,
  onPointSelect,
  onBuildingsChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const buildingsRef = useRef<Building[]>([])
  const visibleRef = useRef<Building[]>([])
  // Off-screen picture of the shade, and the patch of ground it covers.
  const shadeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const extentRef = useRef<ShadowExtent | null>(null)
  const signatureRef = useRef('')
  const drawRef = useRef<() => void>(() => {})
  const placeIndicatorRef = useRef<() => void>(() => {})
  const sunRef = useRef<SunPosition | null>(null)
  const callbacksRef = useRef({ onPointSelect, onBuildingsChange })
  const [hint, setHint] = useState<Hint>(null)
  const [ready, setReady] = useState(false)
  // Without a forecast the sunlight overlay is drawn as under a clear sky.
  const sunFactor = sunStrength ?? 1
  const skyPhaseRef = useRef<SkyPhase | null>(null)

  useEffect(() => {
    callbacksRef.current = { onPointSelect, onBuildingsChange }
  })

  // Moves the sun icon to the screen direction the light comes from. Runs on
  // every camera frame, so it writes straight to the element instead of going
  // through React state.
  useEffect(() => {
    placeIndicatorRef.current = () => {
      const map = mapRef.current
      const element = indicatorRef.current
      const sun = sunRef.current
      if (!map || !element || !sun || sun.altitudeRad <= 0) return
      const mapCenter = map.getCenter()
      // A point 300 m toward the sun, projected to the screen, gives the
      // direction exactly, whatever the map's rotation and tilt.
      const bearing = (sun.bearingDeg * Math.PI) / 180
      const step = metersToDegrees(300 * Math.sin(bearing), 300 * Math.cos(bearing), mapCenter.lat)
      const from = map.project(mapCenter)
      const to = map.project([mapCenter.lng + step.dLon, mapCenter.lat + step.dLat])
      const angle = Math.atan2(to.y - from.y, to.x - from.x)
      const { clientWidth: width, clientHeight: height } = map.getContainer()
      const wide = window.matchMedia('(min-width: 721px)').matches
      // Wide screens: keep clear of the panel on the left. Phones: stay above the bottom sheet.
      const insets = wide
        ? { left: PANEL_WIDTH_PX, right: 0, top: 0, bottom: 0 }
        : { left: 0, right: 0, top: 0, bottom: height * 0.5 }
      const position = sunIndicatorPosition(angle, width, height, insets)
      element.style.setProperty('--sun-x', `${position.x.toFixed(1)}px`)
      element.style.setProperty('--sun-y', `${position.y.toFixed(1)}px`)
      // The rays leave the sun and travel across the map, away from it.
      element.style.setProperty('--ray-angle', `${(angle + Math.PI).toFixed(4)}rad`)
    }
  }, [])

  // Redraws the shadow layer for the current view and `sunTime`.
  useEffect(() => {
    drawRef.current = () => {
      const map = mapRef.current
      const source = map?.getSource<CanvasSource>(SHADOW_SOURCE)
      const context = shadeCanvasRef.current?.getContext('2d')
      if (!map || !source || !context) return
      // Paint the shade picture and hand the new pixels to the map.
      const show = (rings: Ring[]) => {
        const extent = extentRef.current
        paintShadows(
          context,
          SHADOW_CANVAS_PX,
          SHADOW_CANVAS_PX,
          extent ?? { west: 0, south: 0, east: 1, north: 1 },
          extent ? rings : [],
          visibleRef.current.map((building) => building.ring),
        )
        // A canvas source only re-reads its canvas while "playing"; one frame is enough.
        // `pause()` would upload the picture a second time, so the flag is cleared
        // directly once that frame has drawn (falling back to pause() if MapLibre renames it).
        source.play()
        map.once('render', () => {
          const internals = source as unknown as { _playing?: boolean }
          if (typeof internals._playing === 'boolean') internals._playing = false
          else source.pause()
        })
      }
      const mapCenter = map.getCenter()
      // The sun's direction is effectively the same across one viewport.
      const sun = getSunPosition(sunTime, mapCenter.lat, mapCenter.lng)
      sunRef.current = sun
      placeIndicatorRef.current()
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

      if (map.getZoom() < MIN_SHADOW_ZOOM || sun.altitudeRad <= 0) {
        show([])
        setHint(sun.altitudeRad <= 0 ? 'night' : 'zoom')
        return
      }

      const rings: Ring[] = []
      for (const building of visibleRef.current) {
        const offset = shadowOffset(building.height, sun, mapCenter.lat)
        if (!offset) continue
        // Only the shade beyond the footprint is painted; footprints are cut out anyway.
        for (const ribbon of shadowRibbons(building.ring, offset)) rings.push(ribbon)
      }
      show(rings)
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

    // Keep the canvas the size of its container, whatever resizes it.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const resizeMap = () => {
      map.resize()
      placeIndicatorRef.current()
      // Mobile browsers settle their toolbars a moment after the event.
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        map.resize()
        placeIndicatorRef.current()
      }, 200)
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
      // The shade picture covers only where these buildings can throw shade, which keeps it sharp.
      const extent = shadowExtent(
        [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        visible.map((building) => building.bbox),
        margin,
      )
      extentRef.current = extent
      if (extent) map.getSource<CanvasSource>(SHADOW_SOURCE)?.setCoordinates(extentCorners(extent) as never)
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
      // The shade is one picture painted off-screen (see lib/shadowCanvas.ts) and
      // laid on the ground. Painting merges overlapping shadows without a
      // polygon union, gives the shade a clean outline, and drapes over terrain.
      const shadeCanvas = document.createElement('canvas')
      shadeCanvas.width = SHADOW_CANVAS_PX
      shadeCanvas.height = SHADOW_CANVAS_PX
      shadeCanvasRef.current = shadeCanvas
      const here = map.getCenter()
      map.addSource(SHADOW_SOURCE, {
        type: 'canvas',
        canvas: shadeCanvas,
        animate: false,
        // Placeholder patch; the real extent is set as soon as buildings are known.
        coordinates: [
          [here.lng - 0.001, here.lat + 0.001],
          [here.lng + 0.001, here.lat + 0.001],
          [here.lng + 0.001, here.lat - 0.001],
          [here.lng - 0.001, here.lat - 0.001],
        ],
      })
      map.addLayer(
        {
          id: SHADOW_LAYER,
          type: 'raster',
          source: SHADOW_SOURCE,
          paint: { 'raster-opacity': SHADE_OPACITY.map, 'raster-fade-duration': 0 },
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
      if (map.getLayer(BUILDING_3D_LAYER)) {
        map.setPaintProperty(BUILDING_3D_LAYER, 'fill-extrusion-opacity', BUILDING_OPACITY_ON_MAP)
        map.setPaintProperty(BUILDING_3D_LAYER, 'fill-extrusion-color', '#efeae0')
      }
      setReady(true)
      refresh()
    })
    map.on('move', () => placeIndicatorRef.current())
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

  // Shade keeps one clear strength per basemap; cloud never fades it.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map?.getLayer(SHADOW_LAYER)) return
    map.setPaintProperty(SHADOW_LAYER, 'raster-opacity', SHADE_OPACITY[basemap])
  }, [ready, basemap])

  // The sunlight tint follows the same rule, and only shows where shadows are
  // drawn too: without them the whole map would wrongly look sunlit.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map?.getLayer(SUNLIGHT_LAYER)) return
    // `hint` is null exactly when the sun is up and shadows are being drawn.
    const opacity = showSunlight ? sunlightOpacity(sunFactor, hint === null) : 0
    map.setPaintProperty(SUNLIGHT_LAYER, 'fill-opacity', opacity)
  }, [ready, showSunlight, sunFactor, hint])

  // Satellite photo under the shadows. Its tiles are only requested once it is switched on.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const satellite = basemap === 'satellite'
    if (satellite && !map.getSource(IMAGERY_SOURCE)) {
      map.addSource(IMAGERY_SOURCE, {
        type: 'raster',
        tiles: [esriImageryTileUrl(import.meta.env.VITE_ESRI_KEY as string | undefined)],
        tileSize: 256,
        maxzoom: IMAGERY_MAX_ZOOM,
        attribution: ESRI_ATTRIBUTION,
      })
      // Above the drawn land and roads, below the sunlight tint, shadows, buildings and labels.
      map.addLayer(
        { id: IMAGERY_LAYER, type: 'raster', source: IMAGERY_SOURCE, paint: { 'raster-opacity': imageryOpacity } },
        SUNLIGHT_LAYER,
      )
    }
    if (!map.getLayer(IMAGERY_LAYER)) return
    map.setLayoutProperty(IMAGERY_LAYER, 'visibility', satellite ? 'visible' : 'none')
    map.setPaintProperty(IMAGERY_LAYER, 'raster-opacity', imageryOpacity)
    // Mute the photo so its own, frozen shadows recede behind the computed shade.
    const tone = imageryTone(imageryOpacity)
    map.setPaintProperty(IMAGERY_LAYER, 'raster-saturation', tone.saturation)
    map.setPaintProperty(IMAGERY_LAYER, 'raster-contrast', tone.contrast)
    map.setPaintProperty(IMAGERY_LAYER, 'raster-brightness-min', tone.brightnessMin)
    if (map.getLayer(BUILDING_3D_LAYER)) {
      map.setPaintProperty(
        BUILDING_3D_LAYER,
        'fill-extrusion-opacity',
        satellite ? BUILDING_OPACITY_ON_IMAGERY : BUILDING_OPACITY_ON_MAP,
      )
    }
  }, [ready, basemap, imageryOpacity])

  // Labels are pale-on-light for the drawn map and white-on-dark over a photo.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    applyCleanBasemap(map as unknown as Parameters<typeof applyCleanBasemap>[0], basemap === 'satellite')
  }, [ready, basemap])

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
              'hillshade-exaggeration': 0.5,
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
      drawRef.current()
    } else if (map.getSource(TERRAIN_SOURCE)) {
      map.setTerrain(null)
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

  // Label for the indicator. The sun is in practically the same place for the
  // whole view, so the selected location stands in for the map centre here.
  const labelSun = getSunPosition(sunTime, center.lat, center.lon)
  const sunUp = labelSun.altitudeDeg > 0
  const showIndicator = ready && showSunDirection && sunUp

  // The icon is positioned by `placeIndicatorRef`; place it as soon as it appears.
  useEffect(() => {
    if (showIndicator) placeIndicatorRef.current()
  }, [showIndicator])

  return (
    <>
      <div ref={containerRef} className="map" aria-label="3D map" />
      <div className={`map-dim${hint === 'night' ? ' is-night' : ''}`} />
      <div
        ref={indicatorRef}
        className={`sun-indicator${showIndicator ? ' is-visible' : ''}`}
        role="status"
        aria-hidden={!showIndicator}
      >
        <div className="sun-indicator__rays" aria-hidden="true" />
        <div className="sun-indicator__sun" aria-hidden="true" />
        <div className="sun-indicator__label">{sunDirectionLabel(labelSun, sunStrength)}</div>
      </div>
      {ready && hint === null && (
        <div className="map-legend">
          <i style={{ background: SHADE_FILL }} aria-hidden="true" />
          <span>
            <strong>Shade at {shadeTimeLabel}</strong>
            {basemap === 'satellite' && ' · darker patches in the photo are old shadows'}
          </span>
        </div>
      )}
      {hint && (
        <div className="map-hint" role="status">
          {HINT_TEXT[hint]}
        </div>
      )}
    </>
  )
}
