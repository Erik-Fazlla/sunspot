// The sun's path for one day, drawn on the map as a sky dome seen from above:
// the ring is the horizon, the middle is straight overhead, and the sun sits
// in its compass direction, closer to the middle the higher it stands.

import { getSunPosition, getSunTimes, type SunPosition } from './sun'
import { formatTimeInTz, parseTimeInput, zonedToUtc } from './time'

/** Where the sun is at one clock time of the day. */
export interface SunPathSample {
  /** Minutes after midnight, on the place's clock. */
  minutes: number
  altitudeDeg: number
  bearingDeg: number
}

export interface SunPathDay {
  /** The daylight part of the day in time order, from sunrise to sunset. */
  samples: SunPathSample[]
  /** Null when the sun does not rise or set that day (polar day or night). */
  sunrise: SunPathSample | null
  sunset: SunPathSample | null
}

/** Sample spacing: the same 5 minutes the time slider steps in. */
export const SUN_PATH_STEP_MIN = 5

/** The sun's positions while it is up on `dateStr`, with sunrise and sunset on the horizon. */
export function sunPathDay(
  dateStr: string,
  timeZone: string,
  lat: number,
  lon: number,
  stepMin = SUN_PATH_STEP_MIN,
): SunPathDay {
  const samples: SunPathSample[] = []
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMin) {
    const sun = getSunPosition(zonedToUtc(dateStr, minutes, timeZone), lat, lon)
    if (sun.altitudeDeg > 0) samples.push({ minutes, altitudeDeg: sun.altitudeDeg, bearingDeg: sun.bearingDeg })
  }

  const times = getSunTimes(dateStr, timeZone, lat, lon)
  const onHorizon = (instant: Date | null): SunPathSample | null => {
    if (!instant) return null
    // Read the clock rather than subtracting midnight, so days with a clock change stay right.
    const minutes = parseTimeInput(formatTimeInTz(instant, timeZone))
    if (minutes === null) return null
    return { minutes, altitudeDeg: 0, bearingDeg: getSunPosition(instant, lat, lon).bearingDeg }
  }
  const sunrise = onHorizon(times.sunrise)
  const sunset = onHorizon(times.sunset)
  // The official sunrise comes a few minutes before the sun's centre clears the
  // horizon, so samples that fall outside it are dropped to keep the ends on the ring.
  const inside = samples.filter(
    (sample) => (!sunrise || sample.minutes > sunrise.minutes) && (!sunset || sample.minutes < sunset.minutes),
  )
  if (sunrise) inside.unshift(sunrise)
  if (sunset) inside.push(sunset)
  return { samples: inside, sunrise, sunset }
}

/**
 * Ground position of a sun on the dome, in metres east and north of its
 * centre: on the ring at the horizon, in the middle when overhead, evenly
 * spaced in between (30 degrees up is two thirds of the way out).
 */
export function domeOffset(
  sun: Pick<SunPosition, 'altitudeDeg' | 'bearingDeg'>,
  radiusM: number,
): { east: number; north: number } {
  const altitude = Math.min(90, Math.max(0, sun.altitudeDeg))
  const distance = radiusM * (1 - altitude / 90)
  const bearing = (sun.bearingDeg * Math.PI) / 180
  return { east: distance * Math.sin(bearing), north: distance * Math.cos(bearing) }
}

export interface ScreenPoint {
  x: number
  y: number
}

/** Turns metres east and north of the dome's centre into screen pixels. */
export type GroundToScreen = (eastM: number, northM: number) => ScreenPoint

export interface LabelledPoint extends ScreenPoint {
  label: string
}

export interface SunPathGeometry {
  centre: ScreenPoint
  /** SVG path of the horizon ring. */
  ring: string
  /** N, E, S and W, just inside the ring. */
  compass: LabelledPoint[]
  /** SVG path of the whole day, sunrise to sunset. */
  path: string
  /** SVG path of the selected time window; empty when it has no daylight. */
  window: string
  /** A dot on every full hour. */
  hourDots: ScreenPoint[]
  /** Clock hours written next to every third dot, pushed away from the centre. */
  hourLabels: LabelledPoint[]
  sunrise: ScreenPoint | null
  sunset: ScreenPoint | null
  /** The sun at the selected time; null when it is down. */
  sun: ScreenPoint | null
}

const RING_STEPS = 72
/** Hours that get a number; the rest only get a dot. */
const LABEL_EVERY_HOURS = 3
/** How far, in pixels, an hour number sits from its dot. */
const HOUR_LABEL_GAP_PX = 15
/** Compass letters sit just inside the ring, leaving the outside to the sunrise and sunset times. */
const COMPASS_AT = 0.9

const fixed = (value: number) => value.toFixed(1)

function svgPath(points: ScreenPoint[], close = false): string {
  if (points.length < 2) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${fixed(p.x)} ${fixed(p.y)}`).join('') + (close ? 'Z' : '')
}

/** Everything the overlay draws, in screen pixels, for one camera position. */
export function sunPathGeometry(
  toScreen: GroundToScreen,
  radiusM: number,
  day: SunPathDay,
  window: { startMin: number; endMin: number },
  sun: Pick<SunPosition, 'altitudeDeg' | 'bearingDeg'> | null,
): SunPathGeometry {
  const place = (sample: Pick<SunPosition, 'altitudeDeg' | 'bearingDeg'>) => {
    const offset = domeOffset(sample, radiusM)
    return toScreen(offset.east, offset.north)
  }
  const centre = toScreen(0, 0)

  const ring: ScreenPoint[] = []
  for (let i = 0; i < RING_STEPS; i++) {
    const angle = (i / RING_STEPS) * Math.PI * 2
    ring.push(toScreen(radiusM * Math.sin(angle), radiusM * Math.cos(angle)))
  }
  const compass = (['N', 'E', 'S', 'W'] as const).map((label, i) => {
    const angle = (i * Math.PI) / 2
    const reach = radiusM * COMPASS_AT
    return { label, ...toScreen(reach * Math.sin(angle), reach * Math.cos(angle)) }
  })

  const points = day.samples.map(place)
  const inWindow = points.filter((_, i) => {
    const { minutes } = day.samples[i]
    return minutes >= window.startMin && minutes <= window.endMin
  })

  const hourDots: ScreenPoint[] = []
  const hourLabels: LabelledPoint[] = []
  day.samples.forEach((sample, i) => {
    // Sunrise and sunset have their own markers.
    if (sample.minutes % 60 !== 0 || sample === day.sunrise || sample === day.sunset) return
    const point = points[i]
    hourDots.push(point)
    const hour = sample.minutes / 60
    if (hour % LABEL_EVERY_HOURS !== 0) return
    const dx = point.x - centre.x
    const dy = point.y - centre.y
    const length = Math.hypot(dx, dy) || 1
    hourLabels.push({
      label: String(hour),
      x: point.x + (dx / length) * HOUR_LABEL_GAP_PX,
      y: point.y + (dy / length) * HOUR_LABEL_GAP_PX,
    })
  })

  return {
    centre,
    ring: svgPath(ring, true),
    compass,
    path: svgPath(points),
    window: svgPath(inWindow),
    hourDots,
    hourLabels,
    sunrise: day.sunrise ? place(day.sunrise) : null,
    sunset: day.sunset ? place(day.sunset) : null,
    sun: sun && sun.altitudeDeg > 0 ? place(sun) : null,
  }
}

/** Parts of the map area covered by other UI (the panel), in pixels. */
export interface Insets {
  left: number
  right: number
  top: number
  bottom: number
}

/** Share of the free map's smaller side that the dome's radius takes. */
const DOME_SHARE = 0.3
const DOME_MAX_RADIUS_PX = 250
const DOME_MIN_RADIUS_PX = 70

/** Centre and radius, in pixels, of the dome inside the part of the map other UI leaves free. */
export function domeFrame(
  width: number,
  height: number,
  insets: Insets,
): { x: number; y: number; radiusPx: number } {
  const freeWidth = Math.max(0, width - insets.left - insets.right)
  const freeHeight = Math.max(0, height - insets.top - insets.bottom)
  const radiusPx = Math.min(
    DOME_MAX_RADIUS_PX,
    Math.max(DOME_MIN_RADIUS_PX, Math.min(freeWidth, freeHeight) * DOME_SHARE),
  )
  return { x: insets.left + freeWidth / 2, y: insets.top + freeHeight / 2, radiusPx }
}
