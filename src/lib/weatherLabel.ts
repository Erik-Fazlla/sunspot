export type WeatherLabel = 'Sunny' | 'Partly sunny' | 'Overcast' | 'Rainy'

/** One forecast hour. Open-Meteo may return null for a missing value. */
export interface HourWeather {
  /** Local wall-clock hour in the place's timezone, e.g. "2026-10-12T14:00". */
  time: string
  /** Total cloud cover, mean over the hour starting at `time`, % */
  cloudCover: number | null
  /** Chance of precipitation in the hour starting at `time`, % */
  precipitationProbability: number | null
  /** Precipitation in the hour starting at `time`, mm */
  precipitation: number | null
  /** Air temperature at 2 m, degrees C */
  temperature: number | null
  /** Direct solar radiation on a horizontal plane, mean over the hour starting at `time`, W/m2 */
  directRadiation: number | null
  /** Total (direct + diffuse) solar radiation, mean over the hour starting at `time`, W/m2 */
  shortwaveRadiation: number | null
}

/**
 * Thresholds behind the label. Checked in this order:
 *
 * 1. Rainy        precipitation >= 0.2 mm in the hour, or rain chance >= 60 %.
 * 2. Overcast     cloud cover >= 80 %, or (in daylight) less than 15 % of the
 *                 solar radiation arrives as a direct beam.
 * 3. Sunny        cloud cover <= 25 % and (in daylight) at least half of the
 *                 solar radiation is a direct beam.
 * 4. Partly sunny everything in between.
 *
 * "In daylight" means total shortwave radiation >= 20 W/m2. Below that the sun
 * is down or on the horizon, the direct share is meaningless, and only cloud
 * cover and rain decide.
 */
export const WEATHER_THRESHOLDS = {
  rainMm: 0.2,
  rainProbabilityPct: 60,
  overcastCloudPct: 80,
  sunnyCloudPct: 25,
  daylightShortwaveWm2: 20,
  overcastDirectShare: 0.15,
  sunnyDirectShare: 0.5,
} as const

export function weatherLabel(hour: HourWeather): WeatherLabel {
  const t = WEATHER_THRESHOLDS
  const cloud = hour.cloudCover ?? 0
  if ((hour.precipitation ?? 0) >= t.rainMm || (hour.precipitationProbability ?? 0) >= t.rainProbabilityPct) {
    return 'Rainy'
  }
  const shortwave = hour.shortwaveRadiation ?? 0
  const daylight = shortwave >= t.daylightShortwaveWm2
  const directShare = daylight ? (hour.directRadiation ?? 0) / shortwave : null
  if (cloud >= t.overcastCloudPct || (directShare !== null && directShare < t.overcastDirectShare)) {
    return 'Overcast'
  }
  if (cloud <= t.sunnyCloudPct && (directShare === null || directShare >= t.sunnyDirectShare)) {
    return 'Sunny'
  }
  return 'Partly sunny'
}

/** CSS modifier for a label: "Partly sunny" -> "partly-sunny". */
export function labelSlug(label: WeatherLabel): string {
  return label.toLowerCase().replace(' ', '-')
}
