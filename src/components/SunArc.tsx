import { useMemo } from 'react'
import { compassPoint, getSunPosition, getSunTimes } from '../lib/sun'
import { formatTimeInTz, zonedToUtc } from '../lib/time'

const WIDTH = 340
const HEIGHT = 104
const HORIZON_Y = 76
const SAMPLE_MINUTES = 15

interface Props {
  date: string
  timezone: string
  lat: number
  lon: number
  startMin: number
  endMin: number
  currentMin: number
}

const xAt = (minutes: number) => (minutes / 1440) * WIDTH
// 90 degrees up reaches the top; below the horizon the curve is squashed.
const yAt = (altitudeDeg: number) =>
  altitudeDeg >= 0 ? HORIZON_Y - (altitudeDeg / 90) * (HORIZON_Y - 8) : Math.min(HEIGHT - 4, HORIZON_Y - altitudeDeg * 0.45)

/** The sun's height through the selected day, with the time window and the slider position marked. */
export function SunArc({ date, timezone, lat, lon, startMin, endMin, currentMin }: Props) {
  const curve = useMemo(() => {
    const points: [number, number][] = []
    for (let minutes = 0; minutes <= 1440; minutes += SAMPLE_MINUTES) {
      const sun = getSunPosition(zonedToUtc(date, minutes, timezone), lat, lon)
      points.push([xAt(minutes), yAt(sun.altitudeDeg)])
    }
    const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')
    const daylight = points
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${Math.min(y, HORIZON_Y).toFixed(1)}`)
      .join('')
    return { line, area: `${daylight}L${WIDTH} ${HORIZON_Y}L0 ${HORIZON_Y}Z` }
  }, [date, timezone, lat, lon])

  const times = useMemo(() => getSunTimes(date, timezone, lat, lon), [date, timezone, lat, lon])
  const now = getSunPosition(zonedToUtc(date, currentMin, timezone), lat, lon)
  const up = now.altitudeDeg > 0

  return (
    <div>
      <svg className="sunarc" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Sun height through the day">
        <defs>
          <linearGradient id="sunarc-day" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f59e0b" stopOpacity="0.38" />
            <stop offset="1" stopColor="#f59e0b" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <rect
          x={xAt(startMin)}
          y="4"
          width={Math.max(2, xAt(endMin) - xAt(startMin))}
          height={HEIGHT - 20}
          rx="3"
          fill="#2b3763"
          opacity="0.12"
        />
        <path d={curve.area} fill="url(#sunarc-day)" />
        <path d={curve.line} fill="none" stroke="#c2570a" strokeWidth="1.8" strokeLinejoin="round" />
        <line x1="0" x2={WIDTH} y1={HORIZON_Y} y2={HORIZON_Y} stroke="#1b2233" strokeOpacity="0.3" strokeDasharray="3 4" />
        {[6, 12, 18].map((hour) => (
          <text key={hour} x={xAt(hour * 60)} y={HEIGHT - 3} textAnchor="middle" fontSize="10" fill="#5b6479">
            {String(hour).padStart(2, '0')}:00
          </text>
        ))}
        <circle
          className="sunarc__dot"
          cx={xAt(currentMin)}
          cy={yAt(now.altitudeDeg)}
          r="6.5"
          fill={up ? '#f59e0b' : '#2b3763'}
          stroke="#fff"
          strokeWidth="2.5"
        />
      </svg>
      <div className="sunrow">
        <div>
          <span>Sunrise </span>
          <strong>{times.sunrise ? formatTimeInTz(times.sunrise, timezone) : 'none'}</strong>
        </div>
        <div>
          <span>Sunset </span>
          <strong>{times.sunset ? formatTimeInTz(times.sunset, timezone) : 'none'}</strong>
        </div>
        <div>
          <span>Sun </span>
          <strong>
            {up
              ? `${Math.round(now.altitudeDeg)}° up, ${compassPoint(now.bearingDeg)}`
              : 'below horizon'}
          </strong>
        </div>
      </div>
    </div>
  )
}
