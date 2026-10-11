import type { ForecastState } from '../hooks/useForecast'
import { combinedMessage, hoursInWindow, type PointAnalysis } from '../lib/analysis'
import { STEP_MINUTES } from '../lib/constants'
import { compassPoint, type SunPosition } from '../lib/sun'
import { formatMinutes } from '../lib/time'
import { labelSlug, weatherLabel } from '../lib/weatherLabel'

interface Props {
  analysis: PointAnalysis | null
  forecast: ForecastState
  startMin: number
  endMin: number
  currentMin: number
  /** False when no building footprints are loaded around the point (zoomed out). */
  hasBuildings: boolean
  onClear: () => void
}

const STATE_LABEL = { sun: 'direct sun', shade: 'building shade', night: 'sun below horizon' } as const

function sunText(sun: SunPosition): string {
  if (sun.altitudeDeg <= 0) return 'below horizon'
  return `${sun.altitudeDeg.toFixed(1)}° up · ${Math.round(sun.bearingDeg)}° ${compassPoint(sun.bearingDeg)}`
}

export function ResultCard({ analysis, forecast, startMin, endMin, currentMin, hasBuildings, onClear }: Props) {
  if (!analysis) {
    return (
      <p className="result__empty">
        <i aria-hidden="true" />
        Click or tap any spot on the map to check how much direct sun it gets.
      </p>
    )
  }

  const hours = forecast.status === 'ready' ? hoursInWindow(forecast.forecast, startMin, endMin) : null
  const message = forecast.status === 'loading' ? null : combinedMessage(analysis, hours)

  return (
    <div className="result">
      <p className="result__headline">
        <strong>{analysis.sunMinutes}</strong> of {analysis.totalMinutes} min in direct sun
      </p>

      <div className="strip" role="img" aria-label="Sun and shade through the window">
        {analysis.samples.map((sample, i) => (
          <span
            key={sample.minutes}
            className={`strip__cell strip__cell--${sample.state}${
              currentMin >= sample.minutes && currentMin < sample.minutes + STEP_MINUTES ? ' is-current' : ''
            }`}
            style={{ animationDelay: `${i * 18}ms` }}
            title={`${formatMinutes(sample.minutes)}: ${STATE_LABEL[sample.state]}`}
          />
        ))}
      </div>
      <div className="legend">
        <span>
          <i style={{ background: 'var(--sun)' }} />
          Sun {analysis.sunMinutes} min
        </span>
        <span>
          <i style={{ background: 'var(--shade)' }} />
          Shade {analysis.shadeMinutes} min
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
            return (
              <span key={hour.time} className={`chip chip--${labelSlug(label)}`}>
                {hour.time.slice(11, 16)} {label}
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
