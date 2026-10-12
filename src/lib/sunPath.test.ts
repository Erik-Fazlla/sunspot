import { describe, expect, it } from 'vitest'
import { getSunPosition } from './sun'
import { domeFrame, domeOffset, sunPathDay, sunPathGeometry, type GroundToScreen, type SunPathDay } from './sunPath'
import { zonedToUtc } from './time'

const ATHENS = { lat: 37.9838, lon: 23.7275, tz: 'Europe/Athens' }

describe('sunPathDay', () => {
  const day = sunPathDay('2026-06-21', ATHENS.tz, ATHENS.lat, ATHENS.lon)

  it('runs from sunrise to sunset in time order, with both ends on the horizon', () => {
    expect(day.sunrise).not.toBeNull()
    expect(day.sunset).not.toBeNull()
    expect(day.samples[0]).toBe(day.sunrise)
    expect(day.samples[day.samples.length - 1]).toBe(day.sunset)
    expect(day.sunrise!.altitudeDeg).toBe(0)
    expect(day.sunset!.altitudeDeg).toBe(0)
    for (let i = 1; i < day.samples.length; i++) {
      expect(day.samples[i].minutes).toBeGreaterThan(day.samples[i - 1].minutes)
    }
  })

  it('has the midsummer sun rise in the north-east, peak high in the south and set in the north-west', () => {
    // Athens, 21 June: sunrise about 06:03, sunset about 20:51 local time.
    expect(day.sunrise!.minutes).toBeGreaterThan(5 * 60 + 50)
    expect(day.sunrise!.minutes).toBeLessThan(6 * 60 + 15)
    expect(day.sunset!.minutes).toBeGreaterThan(20 * 60 + 40)
    expect(day.sunset!.minutes).toBeLessThan(21 * 60)
    expect(day.sunrise!.bearingDeg).toBeGreaterThan(50)
    expect(day.sunrise!.bearingDeg).toBeLessThan(70)
    expect(day.sunset!.bearingDeg).toBeGreaterThan(290)
    expect(day.sunset!.bearingDeg).toBeLessThan(310)
    const peak = day.samples.reduce((a, b) => (b.altitudeDeg > a.altitudeDeg ? b : a))
    expect(peak.altitudeDeg).toBeGreaterThan(74)
    expect(peak.altitudeDeg).toBeLessThan(76.5)
    expect(peak.bearingDeg).toBeGreaterThan(165)
    expect(peak.bearingDeg).toBeLessThan(195)
  })

  it('agrees with the sun position used for the shadows', () => {
    const sample = day.samples.find((s) => s.minutes === 14 * 60)!
    const sun = getSunPosition(zonedToUtc('2026-06-21', 14 * 60, ATHENS.tz), ATHENS.lat, ATHENS.lon)
    expect(sample.altitudeDeg).toBeCloseTo(sun.altitudeDeg)
    expect(sample.bearingDeg).toBeCloseTo(sun.bearingDeg)
  })

  it('is shorter and lower in winter', () => {
    const winter = sunPathDay('2026-12-21', ATHENS.tz, ATHENS.lat, ATHENS.lon)
    expect(winter.samples.length).toBeLessThan(day.samples.length)
    expect(Math.max(...winter.samples.map((s) => s.altitudeDeg))).toBeLessThan(30)
  })

  it('has no sunrise, sunset or daylight in the polar night', () => {
    const polar = sunPathDay('2026-12-21', 'Arctic/Longyearbyen', 78.22, 15.65)
    expect(polar).toEqual({ samples: [], sunrise: null, sunset: null })
  })
})

describe('domeOffset', () => {
  it('puts a sun on the horizon on the ring, in its compass direction', () => {
    const east = domeOffset({ altitudeDeg: 0, bearingDeg: 90 }, 200)
    expect(east.east).toBeCloseTo(200)
    expect(east.north).toBeCloseTo(0)
    const south = domeOffset({ altitudeDeg: 0, bearingDeg: 180 }, 200)
    expect(south.east).toBeCloseTo(0)
    expect(south.north).toBeCloseTo(-200)
  })

  it('moves the sun toward the middle evenly as it climbs', () => {
    expect(domeOffset({ altitudeDeg: 30, bearingDeg: 0 }, 300).north).toBeCloseTo(200)
    expect(domeOffset({ altitudeDeg: 45, bearingDeg: 270 }, 300).east).toBeCloseTo(-150)
    const overhead = domeOffset({ altitudeDeg: 90, bearingDeg: 123 }, 300)
    expect(Math.hypot(overhead.east, overhead.north)).toBeCloseTo(0)
  })

  it('keeps a sun below the horizon on the ring', () => {
    const below = domeOffset({ altitudeDeg: -12, bearingDeg: 0 }, 100)
    expect(below.north).toBeCloseTo(100)
  })
})

describe('sunPathGeometry', () => {
  // North-up, one metre per pixel, centre at (500, 400): east is +x, north is -y.
  const flat: GroundToScreen = (east, north) => ({ x: 500 + east, y: 400 - north })
  const sample = (minutes: number, altitudeDeg: number, bearingDeg: number) => ({ minutes, altitudeDeg, bearingDeg })
  const sunrise = sample(6 * 60 + 20, 0, 90)
  const sunset = sample(18 * 60 + 40, 0, 270)
  const day: SunPathDay = {
    sunrise,
    sunset,
    samples: [
      sunrise,
      sample(7 * 60, 9, 96),
      sample(9 * 60, 30, 120),
      sample(12 * 60, 45, 180),
      sample(14 * 60, 36, 225),
      sample(14 * 60 + 30, 32, 232),
      sample(15 * 60, 27, 240),
      sample(18 * 60, 9, 264),
      sunset,
    ],
  }
  const geometry = sunPathGeometry(flat, 200, day, { startMin: 14 * 60, endMin: 15 * 60 }, sample(0, 45, 180))

  it('draws a closed horizon ring around the centre with the compass letters just inside it', () => {
    expect(geometry.centre).toEqual({ x: 500, y: 400 })
    expect(geometry.ring.startsWith('M500.0 200.0')).toBe(true)
    expect(geometry.ring.endsWith('Z')).toBe(true)
    const north = geometry.compass.find((c) => c.label === 'N')!
    expect(north.x).toBeCloseTo(500)
    expect(north.y).toBeCloseTo(220)
    const east = geometry.compass.find((c) => c.label === 'E')!
    expect(east.x).toBeCloseTo(680)
    expect(geometry.compass.map((c) => c.label)).toEqual(['N', 'E', 'S', 'W'])
  })

  it('starts the day path at sunrise on the ring and ends it at sunset', () => {
    expect(geometry.sunrise!.x).toBeCloseTo(700)
    expect(geometry.sunrise!.y).toBeCloseTo(400)
    expect(geometry.sunset!.x).toBeCloseTo(300)
    expect(geometry.path.startsWith('M700.0 400.0')).toBe(true)
    expect(geometry.path.endsWith('L300.0 400.0')).toBe(true)
    expect(geometry.path.split('L')).toHaveLength(day.samples.length)
  })

  it('puts the sun south of the centre, halfway out, when it is 45 degrees up in the south', () => {
    expect(geometry.sun!.x).toBeCloseTo(500)
    expect(geometry.sun!.y).toBeCloseTo(500)
  })

  it('marks only the selected window on the path', () => {
    expect(geometry.window.split('L')).toHaveLength(3)
    const night = sunPathGeometry(flat, 200, day, { startMin: 0, endMin: 60 }, null)
    expect(night.window).toBe('')
  })

  it('dots every full hour and numbers every third, further from the centre than its dot', () => {
    // 07:00, 09:00, 12:00, 14:00, 15:00 and 18:00; sunrise and sunset are not hours.
    expect(geometry.hourDots).toHaveLength(6)
    expect(geometry.hourLabels.map((l) => l.label)).toEqual(['9', '12', '15', '18'])
    const noon = geometry.hourLabels.find((l) => l.label === '12')!
    expect(noon.x).toBeCloseTo(500)
    expect(noon.y).toBeCloseTo(515)
  })

  it('leaves the sun out when it is down', () => {
    expect(sunPathGeometry(flat, 200, day, { startMin: 0, endMin: 60 }, sample(0, -3, 300)).sun).toBeNull()
    expect(sunPathGeometry(flat, 200, day, { startMin: 0, endMin: 60 }, null).sun).toBeNull()
  })

  it('copes with a day without daylight', () => {
    const dark = sunPathGeometry(flat, 200, { samples: [], sunrise: null, sunset: null }, { startMin: 0, endMin: 60 }, null)
    expect(dark.path).toBe('')
    expect(dark.sunrise).toBeNull()
    expect(dark.hourDots).toEqual([])
  })
})

describe('domeFrame', () => {
  it('centres the dome in the free part of the map', () => {
    const frame = domeFrame(1400, 800, { left: 400, right: 0, top: 0, bottom: 0 })
    expect(frame.x).toBe(900)
    expect(frame.y).toBe(400)
    expect(frame.radiusPx).toBe(240)
    expect(domeFrame(2400, 1400, { left: 400, right: 0, top: 0, bottom: 0 }).radiusPx).toBe(250)
  })

  it('shrinks with the map but stays large enough to read', () => {
    expect(domeFrame(400, 800, { left: 0, right: 0, top: 0, bottom: 400 }).radiusPx).toBeCloseTo(120)
    expect(domeFrame(100, 100, { left: 0, right: 0, top: 0, bottom: 0 }).radiusPx).toBe(70)
  })
})
