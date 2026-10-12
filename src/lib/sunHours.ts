// The sun-hours map: the ground coloured by how much of the selected time
// window it spends clear of building shadows. The shade is painted once per
// sample time and the paintings are added up, so each pixel ends up holding
// the share of the window it was shaded; that share is then turned into one
// of a few colour bands.

import { STEP_MINUTES } from './constants'
import type { Ring } from './shadow'
import { extentProjector, type ShadowExtent } from './shadowCanvas'
import { formatMinutes } from './time'

/** Canvas size in pixels per side. Smaller than the shade picture: it is painted once per sample. */
export const SUN_HOURS_CANVAS_PX = 1024
/** Most sample times painted for one window; longer windows are sampled more coarsely. */
export const SUN_HOURS_MAX_SAMPLES = 13

/**
 * The clock times (minutes after midnight) the window is sampled at: every
 * `stepMin` from its start to its end, or a coarser multiple of that when the
 * window is too long for `maxSamples`.
 */
export function sunHoursSampleMinutes(
  startMin: number,
  endMin: number,
  maxSamples = SUN_HOURS_MAX_SAMPLES,
  stepMin = STEP_MINUTES,
): number[] {
  const span = Math.max(0, endMin - startMin)
  const step = Math.max(1, Math.ceil(span / (Math.max(2, maxSamples) - 1) / stepMin)) * stepMin
  const minutes: number[] = []
  for (let at = startMin; at <= startMin + span; at += step) minutes.push(at)
  return minutes
}

export interface SunHoursBand {
  id: 'none' | 'little' | 'part' | 'most' | 'all'
  /** Red, green, blue and opacity, each 0 to 255. */
  rgba: [number, number, number, number]
}

/**
 * From no sun to sun the whole time. Only ground that loses sun is coloured;
 * ground that is sunny throughout is left clear, so open areas do not turn
 * the map into one flat colour.
 */
export const SUN_HOURS_BANDS: SunHoursBand[] = [
  { id: 'none', rgba: [52, 48, 140, 165] },
  { id: 'little', rgba: [150, 62, 150, 160] },
  { id: 'part', rgba: [226, 96, 88, 155] },
  { id: 'most', rgba: [250, 160, 52, 145] },
  { id: 'all', rgba: [255, 214, 64, 0] },
]

/** Which band a share of the window in the sun (0 to 1) falls into. */
export function sunHoursBandIndex(sunShare: number): number {
  if (!(sunShare > 0)) return 0
  if (sunShare >= 1) return 4
  if (sunShare < 1 / 3) return 1
  return sunShare < 2 / 3 ? 2 : 3
}

/**
 * Turn added-up shade into colours, in place. `pixels` is RGBA canvas data
 * whose opacity is the share of the `samples` sample times a pixel was shaded.
 */
export function colouriseSunHours(pixels: Uint8ClampedArray, samples: number): void {
  // Opacity only takes 256 values, so the band for each is looked up, not recomputed.
  const bandFor = new Uint8Array(256)
  for (let alpha = 0; alpha < 256; alpha++) {
    // Snapping to whole samples absorbs the rounding of 8-bit opacity.
    const sunSamples = Math.round((1 - alpha / 255) * samples)
    bandFor[alpha] = sunHoursBandIndex(samples > 0 ? sunSamples / samples : 0)
  }
  for (let i = 0; i < pixels.length; i += 4) {
    const [red, green, blue, alpha] = SUN_HOURS_BANDS[bandFor[pixels[i + 3]]].rgba
    pixels[i] = red
    pixels[i + 1] = green
    pixels[i + 2] = blue
    pixels[i + 3] = alpha
  }
}

export interface SunHoursLegendItem {
  id: SunHoursBand['id']
  /** CSS colour of the band, without its opacity; null for a band the map leaves clear. */
  color: string | null
  label: string
}

/** Legend entries for a window, in minutes of sun, e.g. "under 20 min". */
export function sunHoursLegend(startMin: number, endMin: number): SunHoursLegendItem[] {
  const span = Math.max(0, endMin - startMin)
  const third = Math.round(span / 3)
  const labels: Record<SunHoursBand['id'], string> = {
    none: 'no sun',
    little: `under ${third} min`,
    part: `${third}–${third * 2} min`,
    most: `over ${third * 2} min`,
    all: `all ${span} min (no colour)`,
  }
  return SUN_HOURS_BANDS.map(({ id, rgba }) => ({
    id,
    color: rgba[3] > 0 ? `rgb(${rgba[0]}, ${rgba[1]}, ${rgba[2]})` : null,
    label: labels[id],
  }))
}

/** "14:00–15:00" */
export function sunHoursWindowLabel(startMin: number, endMin: number): string {
  return `${formatMinutes(startMin)}–${formatMinutes(endMin)}`
}

/**
 * Paint the sun-hours picture into `output`.
 *
 * `samples` holds, for each sample time, the shadow rings at that time, or
 * null when the sun is down (everything counts as shaded). Each is painted
 * solid into `scratch`, which merges overlapping shadows, and added to
 * `output` at 1/N strength, so opacity adds up to the shaded share of the
 * window. That is then coloured by band, and building footprints are cut out:
 * the map is about the ground.
 */
export function paintSunHours(
  scratch: CanvasRenderingContext2D,
  output: CanvasRenderingContext2D,
  size: number,
  extent: ShadowExtent,
  samples: (Ring[] | null)[],
  footprints: Ring[],
): void {
  const project = extentProjector(extent, size, size)
  const trace = (context: CanvasRenderingContext2D, ring: Ring) => {
    context.beginPath()
    const [startX, startY] = project(ring[0])
    context.moveTo(startX, startY)
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = project(ring[i])
      context.lineTo(x, y)
    }
    context.closePath()
  }

  output.globalCompositeOperation = 'source-over'
  output.globalAlpha = 1
  output.clearRect(0, 0, size, size)
  if (samples.length === 0) return

  // 'lighter' adds opacities up instead of blending them.
  output.globalCompositeOperation = 'lighter'
  output.globalAlpha = 1 / samples.length
  scratch.globalCompositeOperation = 'source-over'
  scratch.fillStyle = '#000'
  for (const rings of samples) {
    scratch.clearRect(0, 0, size, size)
    if (rings === null) scratch.fillRect(0, 0, size, size)
    else {
      for (const ring of rings) {
        trace(scratch, ring)
        scratch.fill()
      }
    }
    output.drawImage(scratch.canvas, 0, 0)
  }
  output.globalAlpha = 1
  output.globalCompositeOperation = 'source-over'

  const image = output.getImageData(0, 0, size, size)
  colouriseSunHours(image.data, samples.length)
  output.putImageData(image, 0, 0)

  output.globalCompositeOperation = 'destination-out'
  output.fillStyle = '#000'
  for (const footprint of footprints) {
    trace(output, footprint)
    output.fill()
  }
  output.globalCompositeOperation = 'source-over'
}
