// Shadows are painted into an off-screen canvas that the map shows as one
// picture laid on the ground. Painting every shadow in the same solid colour
// merges overlapping ones for free (no polygon union), so the layer can be
// shown at one even opacity and given a clean outline.

import type { Position } from 'geojson'
import type { BBox, GroundOffset, Ring } from './shadow'

/** Canvas size in pixels per side. 1536 keeps painting and the texture upload quick on a slider step. */
export const SHADOW_CANVAS_PX = 1536
/** Shade is a blue no aerial photo contains, so it cannot be mistaken for a shadow in the picture. */
export const SHADE_FILL = '#2848b8'
export const SHADE_EDGE = '#0b1c63'
/** Outline width in canvas pixels; half of it ends up outside the shade. */
export const SHADE_EDGE_PX = 3

/** The ground area the canvas covers, in degrees. */
export interface ShadowExtent {
  west: number
  south: number
  east: number
  north: number
}

/**
 * The area to paint: where the buildings in play can throw shade (their boxes
 * grown by the longest shadow), clipped to the view grown by the same margin.
 * Keeping it this tight is what keeps the picture sharp. Null with no buildings.
 */
export function shadowExtent(view: BBox, buildingBoxes: BBox[], margin: GroundOffset): ShadowExtent | null {
  if (buildingBoxes.length === 0) return null
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const box of buildingBoxes) {
    if (box[0] < west) west = box[0]
    if (box[1] < south) south = box[1]
    if (box[2] > east) east = box[2]
    if (box[3] > north) north = box[3]
  }
  const extent = {
    west: Math.max(west, view[0]) - margin.dLon,
    south: Math.max(south, view[1]) - margin.dLat,
    east: Math.min(east, view[2]) + margin.dLon,
    north: Math.min(north, view[3]) + margin.dLat,
  }
  return extent.east > extent.west && extent.north > extent.south ? extent : null
}

/** Corner coordinates in the order MapLibre wants: top-left, top-right, bottom-right, bottom-left. */
export function extentCorners(extent: ShadowExtent): [Position, Position, Position, Position] {
  return [
    [extent.west, extent.north],
    [extent.east, extent.north],
    [extent.east, extent.south],
    [extent.west, extent.south],
  ]
}

/** Web Mercator y for a latitude: the map stretches the picture evenly in this, not in degrees. */
const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

/** Maps [lon, lat] to canvas pixels for an extent. */
export function extentProjector(
  extent: ShadowExtent,
  width: number,
  height: number,
): (position: Position) => [number, number] {
  const top = mercatorY(extent.north)
  const scaleX = width / (extent.east - extent.west)
  const scaleY = height / (top - mercatorY(extent.south))
  return ([lon, lat]) => [(lon - extent.west) * scaleX, (top - mercatorY(lat)) * scaleY]
}

/** The drawing calls used here; a real 2D canvas context satisfies it. */
export interface ShadowPainter {
  lineWidth: number
  lineJoin: string
  strokeStyle: string | CanvasGradient | CanvasPattern
  fillStyle: string | CanvasGradient | CanvasPattern
  globalCompositeOperation: string
  clearRect(x: number, y: number, width: number, height: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  stroke(): void
  fill(): void
}

/**
 * Paint shadow rings. Each ring is stroked, then every ring is filled in the
 * same solid colour: filling covers the strokes that run along seams between
 * overlapping pieces, so only the outer rim of the merged shade is left
 * showing, and overlaps merge because the colour is opaque.
 *
 * Rings are drawn one at a time on purpose. A single path holding thousands
 * of overlapping rings takes the browser hundreds of milliseconds to fill;
 * thousands of small fills take a few.
 *
 * `footprints` are then cut out again. Shade is about the ground: without the
 * cut every roof would be painted too (a building's shadow starts under the
 * building), and a whole city block would read as one blue slab.
 */
export function paintShadows(
  painter: ShadowPainter,
  width: number,
  height: number,
  extent: ShadowExtent,
  rings: Ring[],
  footprints: Ring[] = [],
): void {
  painter.globalCompositeOperation = 'source-over'
  painter.clearRect(0, 0, width, height)
  if (rings.length === 0) return
  const project = extentProjector(extent, width, height)
  const trace = (points: [number, number][]) => {
    painter.beginPath()
    painter.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i++) painter.lineTo(points[i][0], points[i][1])
    painter.closePath()
  }
  const shapes = rings.map((ring) => ring.map(project))

  painter.lineJoin = 'bevel'
  painter.lineWidth = SHADE_EDGE_PX
  painter.strokeStyle = SHADE_EDGE
  for (const shape of shapes) {
    trace(shape)
    painter.stroke()
  }
  painter.fillStyle = SHADE_FILL
  for (const shape of shapes) {
    trace(shape)
    painter.fill()
  }

  if (footprints.length === 0) return
  painter.globalCompositeOperation = 'destination-out'
  for (const footprint of footprints) {
    trace(footprint.map(project))
    painter.fill()
  }
  painter.globalCompositeOperation = 'source-over'
}
