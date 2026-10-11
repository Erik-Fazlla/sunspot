import type { ForecastState } from '../hooks/useForecast'
import { hourAt } from '../lib/openMeteo'
import { formatMinutes } from '../lib/time'
import { labelSlug, weatherLabel } from '../lib/weatherLabel'

interface Props {
  state: ForecastState
  /** Slider position, minutes after midnight. */
  currentMin: number
}

const value = (n: number | null, unit: string, digits = 0) => (n === null ? 'n/a' : `${n.toFixed(digits)}${unit}`)

export function WeatherPanel({ state, currentMin }: Props) {
  if (state.status === 'out-of-range') {
    return <p className="note">No forecast for this date. Pick a day inside the 16-day forecast range.</p>
  }
  if (state.status === 'loading') {
    return <div className="skeleton weather__skeleton" role="status" aria-label="Loading forecast" />
  }
  if (state.status === 'error') {
    return (
      <p className="note note--error" role="alert">
        Forecast unavailable: {state.message}.{' '}
        <button type="button" className="link-btn" onClick={state.retry}>
          Try again
        </button>
      </p>
    )
  }

  const hour = hourAt(state.forecast, currentMin)
  if (!hour) return <p className="note">The forecast has no data for this hour.</p>
  const label = weatherLabel(hour)
  const hourStart = Math.floor(currentMin / 60) * 60

  return (
    <div className="weather">
      <div className="weather__head">
        <span className={`chip chip--${labelSlug(label)}`}>{label}</span>
        <span className="weather__temp">{value(hour.temperature, '°C')}</span>
      </div>
      <div className="stats">
        <div className="stat">
          <strong>{value(hour.cloudCover, '%')}</strong>
          <span>Cloud cover</span>
        </div>
        <div className="stat">
          <strong>{value(hour.precipitationProbability, '%')}</strong>
          <span>Rain chance{hour.precipitation ? ` · ${hour.precipitation.toFixed(1)} mm` : ''}</span>
        </div>
        <div className="stat">
          <strong>{value(hour.directRadiation, '')}</strong>
          <span>Direct W/m²</span>
        </div>
      </div>
      <p className="weather__foot">Forecast for the hour from {formatMinutes(hourStart)}</p>
    </div>
  )
}
