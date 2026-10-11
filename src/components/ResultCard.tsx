import type { ForecastState } from '../hooks/useForecast'
import { combinedMessage, effectiveSunMinutes, hoursInWindow, type PointAnalysis } from '../lib/analysis'
import { compassPoint, type SunPosition } from '../lib/sun'
import { formatMinutes } from '../lib/time'
import { labelSlug, weatherLabel } from '../lib/weatherLabel'

interface Props {
  analysis: PointAnalysis | null
  forecast: ForecastState
  /** sunFactor (0 to 1) for a time of day; null while there is no forecast. */
  factorAt: ((minutes: number) => number) | null
  startMin: number
  endMin: number
  currentMin: number
  /** False when no building footprints are loaded around the point (zoomed out). */
  hasBuildings: boolean
  onClear: () => void
}

const STATE_LABEL = { sun: 'no building shadow', shade: 'building shade', night: 'sun below horizon' } as const

function sunText(sun: SunPosition): string {
  if (sun.altitudeDeg <= 0) return 'below horizon'
  return `${sun.altitudeDeg.toFixed(1)}° up · ${Math.round(sun.bearingDeg)}° ${compassPoint(sun.bearingDeg)}`
}

export function ResultCard({
  analysis,
  forecast,
  factorAt,
  startMin,
  endMin,
  currentMin,
  hasBuildings,
  onClear,
}: Props) {
  if (!analysis) {
    return (
      <p className="result__empty">
        <i aria-hidden="true" />
        Click or tap any spot on the map to check how much sun it gets.
      </p>
    )
  }

  const hours = forecast.status === 'ready' ? hoursInWindow(forecast.forecast, startMin, endMin) : null
  const effective = hours && factorAt ? effectiveSunMinutes(analysis, factorAt) : null
  const message = forecast.status === 'loading' ? null : combinedMessage(analysis, hours, effective)

  return (
    <div className="result">
      <div className="metrics">
        <div className="metric">
          <strong>{analysis.sunMinutes}</strong>
          <span>of {analysis.totalMinutes} min clear of building shadows</span>
        </div>
        <div className="metric metric--sun">
          {forecast.status === 'loading' ? (
            <div className="skeleton metric__skeleton" role="status" aria-label="Loading forecast" />
          ) : (
            <>
              <strong>{effective === null ? 'n/a' : `≈${Math.round(effective)}`}</strong>
              <span>{effective === null ? 'effective sun needs a forecast' : 'min of effective sun after cloud'}</span>
            </>
          )}
        </div>
      </div>

      <div className="strip" role="img" aria-label="Sun and shade through the window">
        {analysis.samples.map((sample, i) => (
          <span
            key={sample.minutes}
            className={`strip__cell strip__cell--${sample.state}${
              currentMin >= sample.minutes && currentMin < sample.minutes + sample.duration ? ' is-current' : ''
            }`}
            style={{
              animationDelay: `${i * 18}ms`,
              // Unshaded samples fade with the cloud: paler means weaker sun.
              opacity: sample.state === 'sun' && factorAt ? 0.3 + 0.7 * factorAt(sample.minutes) : undefined,
            }}
            title={`${formatMinutes(sample.minutes)}: ${STATE_LABEL[sample.state]}`}
          />
        ))}
      </div>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--sun)' }} />
          No shadow {analysis.sunMinutes} min
        </span>
        <span>
          <i style={{ background: 'var(--shade)' }} />
          Building shade {analysis.shadeMinutes} min
        </span>
        {analysis.nightMinutes > 0 && (
          <span>
            <i style={{ background: '#10162c' }} />
            Sun down {analysis.nightMinutes} min
          </span>
        )}
      </div>

      {message ? (
        <p className="result__message">{message}</p>
      ) : (
        <div className="skeleton result__message-skeleton" role="status" aria-label="Loading forecast" />
      )}

      <dl className="facts">
        <dt>Sun at {formatMinutes(startMin)}</dt>
        <dd>{sunText(analysis.start)}</dd>
        <dt>Sun at {formatMinutes(endMin)}</dt>
        <dd>{sunText(analysis.end)}</dd>
      </dl>

      {hours && hours.length > 0 && (
        <div className="result__hours">
          {hours.map((hour) => {
            const label = weatherLabel(hour)
            // Each chip shows only the part of its hour that lies inside the window.
            const hourStart = Number(hour.time.slice(11, 13)) * 60
            const from = Math.max(hourStart, startMin)
            const to = Math.min(hourStart + 60, endMin)
            return (
              <span key={hour.time} className={`chip chip--${labelSlug(label)}`}>
                {formatMinutes(from)}–{formatMinutes(to)} {label}
              </span>
            )
          })}
        </div>
      )}

      {!hasBuildings && (
        <p className="note note--warn">
          No building outlines are loaded around this spot, so building shade is not counted. Zoom in closer.
        </p>
      )}

      <button type="button" className="link-btn result__clear" onClick={onClear}>
        Remove marker
      </button>
    </div>
  )
}
