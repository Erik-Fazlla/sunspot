export type WeatherLabel = 'Sunny' | 'Partly sunny' | 'Overcast' | 'Rainy'

/**
 * One forecast hour. Every field describes the hour that starts at `time`, or
 * the instant `time` for the two snapshot fields. Open-Meteo may return null
 * for a missing value.
 */
export interface HourWeather {
  /** Local wall-clock hour in the place's timezone, e.g. "2026-10-12T14:00". */
  time: string
  /** Total cloud cover at `time` (a snapshot), % */
  cloudCover: number | null
  /** Air temperature at 2 m at `time` (a snapshot), degrees C */
  temperature: number | null
  /** Chance of precipitation in the hour starting at `time`, % */
  precipitationProbability: number | null
  /** Precipitation in the hour starting at `time`, mm */
  precipitation: number | null
  /** Direct solar radiation on a horizontal plane, mean over the hour starting at `time`, W/m2 */
  directRadiation: number | null
  /** Total (direct + diffuse) solar radiation, mean over the hour starting at `time`, W/m2 */
  shortwaveRadiation: number | null
}

/**
 * The label is derived from two numbers only, checked in this order:
 *
 * 1. Rainy        rain chance >= 60 %
 * 2. Sunny        sunFactor >= 0.7
 * 3. Partly sunny sunFactor >= 0.3
 * 4. Overcast     anything lower
 *
 * sunFactor (see sunFactor.ts) is the share of the clear-sky direct beam that
 * the forecast lets through, so the label can never disagree with the sun
 * strength shown next to it. Thin high cloud that covers the sky but passes
 * most of the beam counts as sunny; haze under a cloudless sky does not.
 */
export const RAINY_PROBABILITY_PCT = 60
export const SUNNY_SUN_FACTOR = 0.7
export const PARTLY_SUNNY_SUN_FACTOR = 0.3

export function weatherLabel(sunFactor: number, precipitationProbability: number | null): WeatherLabel {
  if ((precipitationProbability ?? 0) >= RAINY_PROBABILITY_PCT) return 'Rainy'
  if (sunFactor >= SUNNY_SUN_FACTOR) return 'Sunny'
  if (sunFactor >= PARTLY_SUNNY_SUN_FACTOR) return 'Partly sunny'
  return 'Overcast'
}

/** CSS modifier for a label: "Partly sunny" -> "partly-sunny". */
export function labelSlug(label: WeatherLabel): string {
  return label.toLowerCase().replace(' ', '-')
}
