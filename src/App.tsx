import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapView } from './components/MapView'
import { SearchBox } from './components/SearchBox'
import { TimeControls } from './components/TimeControls'
import { DEFAULT_TIMEZONE, FALLBACK_PLACE, FORECAST_DAYS, STEP_MINUTES } from './lib/constants'
import type { Place } from './lib/geocode'
import { addDays, diffDays, formatDateLabel, todayInTz } from './lib/time'

type GeoState = { status: 'idle' } | { status: 'locating' } | { status: 'error'; message: string }

const DEFAULT_START_MIN = 14 * 60
const DEFAULT_END_MIN = 15 * 60

export default function App() {
  const [place, setPlace] = useState<Place>(FALLBACK_PLACE)
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' })
  const [date, setDate] = useState(() => addDays(todayInTz(DEFAULT_TIMEZONE), 1))
  const [startMin, setStartMin] = useState(DEFAULT_START_MIN)
  const [endMin, setEndMin] = useState(DEFAULT_END_MIN)
  const [panelOpen, setPanelOpen] = useState(true)

  const timezone = place.timezone ?? DEFAULT_TIMEZONE
  const today = todayInTz(timezone)
  const lastForecastDate = addDays(today, FORECAST_DAYS - 1)

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGeo({ status: 'error', message: 'This browser cannot share your location.' })
      return
    }
    setGeo({ status: 'locating' })
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPlace({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          label: 'My location',
        })
        setGeo({ status: 'idle' })
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was denied, so the map stays where it is.'
            : 'Could not get your location. Search for a place instead.'
        setGeo({ status: 'error', message })
      },
      { timeout: 8000, maximumAge: 10 * 60 * 1000 },
    )
  }, [])

  // Centre on the user when the app opens; Athens stays as the fallback.
  useEffect(() => {
    locate()
  }, [locate])

  const windowValid = endMin > startMin
  // Keep a usable window even while the inputs are mid-edit.
  const windowEnd = windowValid ? endMin : Math.min(startMin + STEP_MINUTES, 24 * 60 - 1)

  const whenMessage = useMemo(() => {
    if (!windowValid) return 'The end time must be after the start time.'
    const offset = diffDays(today, date)
    if (offset < 0 || offset >= FORECAST_DAYS) {
      return `The forecast only covers ${formatDateLabel(today)} to ${formatDateLabel(lastForecastDate)}. Shadows still work for any date.`
    }
    return null
  }, [windowValid, today, date, lastForecastDate])

  return (
    <div className="app">
      <MapView center={place} />

      <aside className={`panel${panelOpen ? '' : ' is-collapsed'}`} aria-label="Sunlight planner">
        <header className="panel__head">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true" />
            <div>
              <h1>Sunspot</h1>
              <p title={place.label}>{place.label}</p>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn icon-btn--ghost"
            onClick={() => setPanelOpen((open) => !open)}
            aria-expanded={panelOpen}
            aria-controls="panel-body"
            aria-label={panelOpen ? 'Collapse panel' : 'Expand panel'}
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" className="chevron">
              <path d="m5 12.5 5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </header>

        <div className="panel__collapse" id="panel-body">
          <div className="panel__body">
            <section className="section">
              <h2 className="section__title">Where</h2>
              <SearchBox
                onSelect={setPlace}
                onLocate={locate}
                locating={geo.status === 'locating'}
                locateMessage={geo.status === 'error' ? geo.message : null}
              />
            </section>

            <section className="section">
              <h2 className="section__title">When</h2>
              <TimeControls
                date={date}
                startMin={startMin}
                endMin={windowEnd}
                minDate={today}
                maxDate={lastForecastDate}
                message={whenMessage}
                onDateChange={setDate}
                onWindowChange={(start, end) => {
                  setStartMin(start)
                  setEndMin(end)
                }}
              />
            </section>

            <footer className="credits">
              Map ©{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap
              </a>{' '}
              contributors · tiles by{' '}
              <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
                OpenFreeMap
              </a>{' '}
              · weather by{' '}
              <a href="https://open-meteo.com" target="_blank" rel="noreferrer">
                Open-Meteo
              </a>
            </footer>
          </div>
        </div>
      </aside>
    </div>
  )
}
