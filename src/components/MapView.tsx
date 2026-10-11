import { useEffect, useRef } from 'react'
import { AttributionControl, Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { DEFAULT_PITCH, DEFAULT_ZOOM, MAP_STYLE_URL } from '../lib/constants'

// Vite pre-bundles maplibre-gl, so its "worker next to the module" lookup
// would miss. Point it at a worker bundle Vite builds for us.
setWorkerUrl(workerUrl)

interface Props {
  center: { lat: number; lon: number }
}

export function MapView({ center }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
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
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    map.on('error', (e) => console.error('[map]', e.error?.message ?? e))
    if (import.meta.env.DEV) (window as unknown as { __map?: MapLibreMap }).__map = map
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
    // The map is created once; later centre changes fly instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    mapRef.current?.flyTo({ center: [center.lon, center.lat], zoom: DEFAULT_ZOOM, duration: 1400 })
  }, [center.lat, center.lon])

  return <div ref={containerRef} className="map" aria-label="3D map" />
}
