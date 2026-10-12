import { useEffect, useReducer } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { metersToDegrees } from '../lib/shadow'
import type { SunPosition } from '../lib/sun'
import { domeFrame, sunPathGeometry, type GroundToScreen, type ScreenPoint, type SunPathDay } from '../lib/sunPath'
import { formatMinutes } from '../lib/time'

/** Width the control panel takes on wide screens; the dome stays clear of it. */
const PANEL_WIDTH_PX = 404
/** Radius of the sun disc, in pixels. */
const SUN_RADIUS_PX = 11
/** Length and half-width of the arrowhead where the light lands. */
const ARROW_LENGTH_PX = 13
const ARROW_HALF_WIDTH_PX = 6
/** Gap between the ring and the sunrise and sunset times. */
const HORIZON_LABEL_GAP_PX = 12
/** Room a sunrise or sunset time needs, to keep it from running off the map. */
const HORIZON_LABEL_WIDTH_PX = 92
/** Gap between the sun and its label. */
const SUN_LABEL_GAP_PX = 24

interface Props {
  map: MapLibreMap
  /** The sun's path for the selected date. */
  day: SunPathDay
  /** The selected time window, in minutes after midnight. */
  windowStartMin: number
  windowEndMin: number
  /** The sun at the selected time. */
  sun: SunPosition
  /** Plain-language summary shown next to the sun. */
  label: string
}

/** Unit vector from `from` to `to`, and the distance between them. */
function direction(from: ScreenPoint, to: ScreenPoint) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  return length > 0 ? { x: dx / length, y: dy / length, length } : { x: 0, y: -1, length: 0 }
}

/**
 * The sun's path for the day, laid on the ground like a compass: the ring is
 * the horizon, the middle is straight overhead. It follows the map as it
 * turns and tilts, so the arrow always shows where the light really comes from.
 */
export function SunPathOverlay({ map, day, windowStartMin, windowEndMin, sun, label }: Props) {
  // The drawing depends on the camera, which React does not know about.
  const [, redraw] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    map.on('move', redraw)
    map.on('resize', redraw)
    return () => {
      map.off('move', redraw)
      map.off('resize', redraw)
    }
  }, [map])

  const { clientWidth: width, clientHeight: height } = map.getContainer()
  const wide = window.matchMedia('(min-width: 721px)').matches
  // Wide screens: keep clear of the panel on the left. Phones: stay above the bottom sheet.
  const frame = domeFrame(
    width,
    height,
    wide ? { left: PANEL_WIDTH_PX, right: 0, top: 0, bottom: 0 } : { left: 0, right: 0, top: 0, bottom: height * 0.5 },
  )
  // The dome lies on the ground under the middle of the free map area, sized
  // by how many metres a pixel covers there.
  const anchor = map.unproject([frame.x, frame.y])
  const beside = map.unproject([frame.x + frame.radiusPx, frame.y])
  const perMetre = metersToDegrees(1, 1, anchor.lat)
  const radiusM = Math.hypot((beside.lng - anchor.lng) / perMetre.dLon, (beside.lat - anchor.lat) / perMetre.dLat)
  const toScreen: GroundToScreen = (east, north) => {
    const offset = metersToDegrees(east, north, anchor.lat)
    const { x, y } = map.project([anchor.lng + offset.dLon, anchor.lat + offset.dLat])
    return { x, y }
  }
  const geometry = sunPathGeometry(toScreen, radiusM, day, { startMin: windowStartMin, endMin: windowEndMin }, sun)
  const { centre } = geometry

  const horizonLabel = (point: ScreenPoint | null, text: string) => {
    if (!point) return null
    const out = direction(centre, point)
    const anchor = out.x > 0.3 ? 'start' : out.x < -0.3 ? 'end' : 'middle'
    // Keep the whole text on the map when the ring comes close to an edge.
    const room = anchor === 'middle' ? HORIZON_LABEL_WIDTH_PX / 2 : HORIZON_LABEL_WIDTH_PX
    const x = point.x + out.x * HORIZON_LABEL_GAP_PX
    return (
      <text
        className="sun-path__text"
        x={anchor === 'end' ? Math.max(x, room) : Math.min(x, width - room)}
        y={point.y + out.y * HORIZON_LABEL_GAP_PX + (anchor === 'middle' ? 0 : out.y * 6)}
        textAnchor={anchor}
        dominantBaseline="middle"
      >
        {text}
      </text>
    )
  }

  // The ray runs from the edge of the sun to an arrowhead on the centre.
  let ray: { line: string; head: string } | null = null
  if (geometry.sun) {
    const toward = direction(geometry.sun, centre)
    if (toward.length > SUN_RADIUS_PX + ARROW_LENGTH_PX + 8) {
      const start = { x: geometry.sun.x + toward.x * SUN_RADIUS_PX, y: geometry.sun.y + toward.y * SUN_RADIUS_PX }
      const base = { x: centre.x - toward.x * ARROW_LENGTH_PX, y: centre.y - toward.y * ARROW_LENGTH_PX }
      const side = { x: -toward.y * ARROW_HALF_WIDTH_PX, y: toward.x * ARROW_HALF_WIDTH_PX }
      ray = {
        line: `M${start.x.toFixed(1)} ${start.y.toFixed(1)}L${base.x.toFixed(1)} ${base.y.toFixed(1)}`,
        head: `${centre.x.toFixed(1)},${centre.y.toFixed(1)} ${(base.x + side.x).toFixed(1)},${(base.y + side.y).toFixed(1)} ${(base.x - side.x).toFixed(1)},${(base.y - side.y).toFixed(1)}`,
      }
    }
  }
  // The label goes on the side of the sun away from the centre, so the ray never runs through it.
  const labelBelow = geometry.sun ? geometry.sun.y >= centre.y : false

  return (
    <div className="sun-path" role="img" aria-label={label}>
      <svg className="sun-path__svg" aria-hidden="true">
        <path className="sun-path__casing" d={geometry.ring} strokeWidth={4} />
        <path className="sun-path__ring" d={geometry.ring} />
        {geometry.compass.map((point) => (
          <text
            key={point.label}
            className={`sun-path__text sun-path__text--compass${point.label === 'N' ? ' is-north' : ''}`}
            x={point.x}
            y={point.y}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {point.label}
          </text>
        ))}

        <path className="sun-path__casing" d={geometry.path} strokeWidth={7} />
        <path className="sun-path__day" d={geometry.path} />
        {geometry.window && (
          <>
            <path className="sun-path__casing" d={geometry.window} strokeWidth={11} />
            <path className="sun-path__window" d={geometry.window} />
          </>
        )}
        {geometry.hourDots.map((point, i) => (
          <circle key={i} className="sun-path__hour" cx={point.x} cy={point.y} r={3} />
        ))}
        {geometry.hourLabels.map((point) => (
          <text
            key={point.label}
            className="sun-path__text sun-path__text--hour"
            x={point.x}
            y={point.y}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {point.label}
          </text>
        ))}

        {geometry.sunrise && <circle className="sun-path__horizon" cx={geometry.sunrise.x} cy={geometry.sunrise.y} r={5} />}
        {geometry.sunset && <circle className="sun-path__horizon" cx={geometry.sunset.x} cy={geometry.sunset.y} r={5} />}
        {day.sunrise && horizonLabel(geometry.sunrise, `Sunrise ${formatMinutes(day.sunrise.minutes)}`)}
        {day.sunset && horizonLabel(geometry.sunset, `Sunset ${formatMinutes(day.sunset.minutes)}`)}

        {ray && (
          <>
            <path className="sun-path__casing" d={ray.line} strokeWidth={7} />
            <path className="sun-path__ray" d={ray.line} />
            <polygon className="sun-path__ray-head" points={ray.head} />
          </>
        )}
        {geometry.sun && (
          <>
            <circle className="sun-path__glow" cx={geometry.sun.x} cy={geometry.sun.y} r={SUN_RADIUS_PX + 9} />
            <circle className="sun-path__sun" cx={geometry.sun.x} cy={geometry.sun.y} r={SUN_RADIUS_PX} />
          </>
        )}
      </svg>
      {geometry.sun && (
        <div
          className={`sun-path__label${labelBelow ? '' : ' is-above'}`}
          style={{ left: geometry.sun.x, top: geometry.sun.y + (labelBelow ? SUN_LABEL_GAP_PX : -SUN_LABEL_GAP_PX) }}
        >
          {label}
        </div>
      )}
    </div>
  )
}
