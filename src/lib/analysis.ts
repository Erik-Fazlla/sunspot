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
  state: SampleState
}

export interface PointAnalysis {
  samples: Sample[]
  totalMinutes: number
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
    samples.push({ minutes, state })
    minutesIn[state] += Math.min(stepMinutes, endMin - minutes)
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

/** One sentence combining the shadow result with the forecast for those hours. */
export function combinedMessage(analysis: PointAnalysis, hours: HourWeather[] | null): string {
  const { totalMinutes: total, sunMinutes: sun, nightMinutes: night } = analysis
  if (total > 0 && night === total) {
    return 'The sun is below the horizon for this whole window, so there is no direct sun.'
  }
  const lead =
    sun === 0
      ? `No direct sun in these ${total} min`
      : sun === total
        ? `In direct sun for all ${total} min`
        : `In direct sun for ${sun} of ${total} min`
  const nightNote = night > 0 ? ` The sun is below the horizon for ${night} min of the window.` : ''
  if (!hours?.length) return `${lead}. The forecast is unavailable, so cloud cover is unknown.${nightNote}`

  const labels = hours.map(weatherLabel)
  const clouds = hours.map((h) => h.cloudCover ?? 0)
  const cloud = Math.round(clouds.reduce((a, b) => a + b, 0) / clouds.length)
  let tail: string
  if (labels.includes('Rainy')) {
    tail = sun > 0 ? ', but rain is likely, so do not count on it' : ', and rain is likely'
  } else if (cloud >= 80 || labels.every((l) => l === 'Overcast')) {
    tail = sun > 0 ? `, but ${cloud}% cloud cover, so expect diffuse light` : `, under ${cloud}% cloud cover`
  } else if (labels.every((l) => l === 'Sunny')) {
    tail = sun > 0 ? ', and the sky should be clear' : ', even though the sky should be clear'
  } else {
    tail = sun > 0 ? `, with ${cloud}% cloud cover, so the sun may come and go` : `, with ${cloud}% cloud cover overhead`
  }
  return `${lead}${tail}.${nightNote}`
}
