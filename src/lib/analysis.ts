import type { Position } from 'geojson'
import { MAX_SHADOW_LENGTH_M, STEP_MINUTES } from './constants'
import type { Forecast } from './openMeteo'
import { isPointInShade, metersToDegrees, type Building } from './shadow'
import { getSunPosition, type SunPosition } from './sun'
import { zonedToUtc } from './time'
import { weatherLabel, type HourWeather } from './weatherLabel'

/** sun = direct sun, shade = a building blocks it, night = the sun is below the horizon. */
export type SampleState = 'sun' | 'shade' | 'night'

export interface Sample {
  /** Minutes after midnight, local time. */
  minutes: number
  /** Minutes this sample stands for (the last one can be shorter than a step). */
  duration: number
  state: SampleState
}

export interface PointAnalysis {
  samples: Sample[]
  totalMinutes: number
  /**
   * Geometric sun: minutes with the sun up and no building in the way.
   * Says nothing about clouds; see `effectiveSunMinutes`.
   */
  sunMinutes: number
  /** Blocked by a building while the sun is up. */
  shadeMinutes: number
  /** Sun below the horizon: counted as "no sun". */
  nightMinutes: number
  start: SunPosition
  end: SunPosition
}

/**
 * Sample the window every `stepMinutes` and classify each sample. A sample at
 * time t stands for the interval [t, t + step), so a 14:00-15:00 window has
 * twelve 5-minute samples and the minutes add up to 60.
 */
export function analyzePoint(
  point: Position,
  buildings: Building[],
  date: string,
  startMin: number,
  endMin: number,
  timeZone: string,
  stepMinutes = STEP_MINUTES,
): PointAnalysis {
  const [lon, lat] = point
  // Only buildings within shadow reach can matter.
  const reach = metersToDegrees(MAX_SHADOW_LENGTH_M, MAX_SHADOW_LENGTH_M, lat)
  const nearby = buildings.filter(
    ({ bbox }) =>
      bbox[2] >= lon - reach.dLon &&
      bbox[0] <= lon + reach.dLon &&
      bbox[3] >= lat - reach.dLat &&
      bbox[1] <= lat + reach.dLat,
  )
  const sunAt = (minutes: number) => getSunPosition(zonedToUtc(date, minutes, timeZone), lat, lon)

  const samples: Sample[] = []
  const minutesIn = { sun: 0, shade: 0, night: 0 }
  for (let minutes = startMin; minutes < endMin; minutes += stepMinutes) {
    const sun = sunAt(minutes)
    const state: SampleState =
      sun.altitudeRad <= 0 ? 'night' : isPointInShade(point, nearby, sun) ? 'shade' : 'sun'
    const duration = Math.min(stepMinutes, endMin - minutes)
    samples.push({ minutes, duration, state })
    minutesIn[state] += duration
  }

  return {
    samples,
    totalMinutes: Math.max(0, endMin - startMin),
    sunMinutes: minutesIn.sun,
    shadeMinutes: minutesIn.shade,
    nightMinutes: minutesIn.night,
    start: sunAt(startMin),
    end: sunAt(endMin),
  }
}

/** Forecast hours that overlap the window (14:00-15:00 -> just the 14:00 hour). */
export function hoursInWindow(forecast: Forecast, startMin: number, endMin: number): HourWeather[] {
  const first = Math.floor(startMin / 60)
  const last = Math.floor(Math.max(startMin, endMin - 1) / 60)
  return forecast.hours.slice(first, last + 1)
}

/**
 * Effective sun: geometric sun weighted by how much direct beam the weather
 * lets through. Each sample counts `duration * sunFactor` when it is in the
 * sun and 0 otherwise, so 40 unshaded minutes at sunFactor 0.3 are 12 minutes.
 * `factorAt` gives the sunFactor (0 to 1) for a time in minutes after midnight.
 */
export function effectiveSunMinutes(analysis: PointAnalysis, factorAt: (minutes: number) => number): number {
  let total = 0
  for (const sample of analysis.samples) {
    if (sample.state === 'sun') total += sample.duration * factorAt(sample.minutes)
  }
  return total
}

/**
 * One or two sentences combining the shadow result with the forecast. "Direct
 * sun" is only ever mentioned together with the cloud situation, because clear
 * of shadows is not the same as sunny. `effectiveMinutes` is null without a forecast.
 */
export function combinedMessage(
  analysis: PointAnalysis,
  hours: HourWeather[] | null,
  effectiveMinutes: number | null,
): string {
  const { totalMinutes: total, sunMinutes: clear, nightMinutes: night } = analysis
  if (total > 0 && night === total) {
    return 'The sun is below the horizon for this whole window, so there is no sunlight to plan around.'
  }
  const nightNote = night > 0 ? ` The sun is below the horizon for ${night} min of the window.` : ''
  if (clear === 0) {
    return `Building shadows cover this spot for the whole window, so it gets no direct sun whatever the sky does.${nightNote}`
  }
  const lead =
    clear === total
      ? `Clear of building shadows for all ${total} min`
      : `Clear of building shadows for ${clear} of ${total} min`
  if (!hours?.length || effectiveMinutes === null) {
    return `${lead}. The forecast is unavailable, so how much of that is real sunshine is unknown.${nightNote}`
  }

  const effective = Math.round(effectiveMinutes)
  const clouds = hours.map((h) => h.cloudCover ?? 0)
  const cloud = Math.round(clouds.reduce((a, b) => a + b, 0) / clouds.length)
  const share = effectiveMinutes / clear
  let tail: string
  if (hours.map(weatherLabel).includes('Rainy')) {
    tail = `, but rain is likely: count on about ${effective} min of actual sunshine at best`
  } else if (share >= 0.8 && cloud >= 60) {
    // Thin high cloud: the sky is covered but the beam still gets through.
    tail = `, and although cloud cover is ${cloud}% it is thin, so most of it is direct sun: about ${effective} min`
  } else if (share >= 0.8) {
    tail = `, and with ${cloud}% cloud cover nearly all of it is direct sun: about ${effective} min`
  } else if (share >= 0.4) {
    tail = `, but with ${cloud}% cloud cover the sun comes and goes: about ${effective} min of direct sun`
  } else {
    tail = `, but with ${cloud}% cloud cover the light is mostly diffuse: only about ${effective} min of direct sun`
  }
  return `${lead}${tail}.${nightNote}`
}
