import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapView, type LngLat } from './components/MapView'
import { ResultCard } from './components/ResultCard'
import { SearchBox } from './components/SearchBox'
import { SunArc } from './components/SunArc'
import { TimeControls } from './components/TimeControls'
import { TimeSlider } from './components/TimeSlider'
import { WeatherPanel } from './components/WeatherPanel'
import { useForecast, useTimezone } from './hooks/useForecast'
import {
  DEFAULT_TIMEZONE,
  FALLBACK_PLACE,
  FORECAST_DAYS,
  PLAY_INTERVAL_MS,
  STEP_MINUTES,
} from './lib/constants'
import { analyzePoint } from './lib/analysis'
import type { Place } from './lib/geocode'
import type { Building } from './lib/shadow'
import { addDays, diffDays, formatDateLabel, todayInTz, zonedToUtc } from './lib/time'

type GeoState = { status: 'idle' } | { status: 'locating' } | { status: 'error'; message: string }

const DEFAULT_START_MIN = 14 * 60
const DEFAULT_END_MIN = 15 * 60

export default function App() {
  const [place, setPlace] = useState<Place>(FALLBACK_PLACE)
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' })
  const [date, setDate] = useState(() => addDays(todayInTz(DEFAULT_TIMEZONE), 1))
  const [startMin, setStartMin] = useState(DEFAULT_START_MIN)
  const [endMin, setEndMin] = useState(DEFAULT_END_MIN)
  const [sliderMin, setSliderMin] = useState(DEFAULT_START_MIN)
  const [playing, setPlaying] = useState(false)
  const [point, setPoint] = useState<LngLat | null>(null)
  const [buildings, setBuildings] = useState<Building[]>([])
  const [panelOpen, setPanelOpen] = useState(true)

  // Weather and timezone follow the clicked point when there is one.
  const target = point ?? place
  const lookedUpTimezone = useTimezone(target.lat, target.lon, point ? undefined : place.timezone)
  const timezone = lookedUpTimezone ?? place.timezone ?? DEFAULT_TIMEZONE
  const today = todayInTz(timezone)
  const lastForecastDate = addDays(today, FORECAST_DAYS - 1)
  const forecastOffset = diffDays(today, date)
  const inForecastRange = forecastOffset >= 0 && forecastOffset < FORECAST_DAYS
  const forecast = useForecast(target.lat, target.lon, date, inForecastRange)

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

  // The slider always sits on a 5-minute step inside the window.
  const currentMin = Math.min(Math.max(sliderMin, startMin), windowEnd)
  const sunTime = useMemo(() => zonedToUtc(date, currentMin, timezone), [date, currentMin, timezone])

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      setSliderMin((minutes) => {
        const next = Math.max(minutes, startMin) + STEP_MINUTES
        return next > windowEnd ? startMin : next
      })
    }, PLAY_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [playing, startMin, windowEnd])

  const analysis = useMemo(
    () =>
      point ? analyzePoint([point.lon, point.lat], buildings, date, startMin, windowEnd, timezone) : null,
    [point, buildings, date, startMin, windowEnd, timezone],
  )

  const whenMessage = useMemo(() => {
    if (!windowValid) return 'The end time must be after the start time.'
    if (!inForecastRange) {
      return `The forecast only covers ${formatDateLabel(today)} to ${formatDateLabel(lastForecastDate)}. Shadows still work for any date.`
    }
    return null
  }, [windowValid, inForecastRange, today, lastForecastDate])

  return (
    <div className="app">
      <MapView
        center={place}
        sunTime={sunTime}
        point={point}
        onPointSelect={(selected) => {
          setPoint(selected)
          setPanelOpen(true)
        }}
        onBuildingsChange={setBuildings}
      />

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

        <div className="panel__pinned">
          <TimeSlider
            startMin={startMin}
            endMin={windowEnd}
            value={currentMin}
            playing={playing}
            onChange={(minutes) => {
              setPlaying(false)
              setSliderMin(minutes)
            }}
            onTogglePlay={() => setPlaying((value) => !value)}
          />
        </div>

        <div className="panel__collapse" id="panel-body">
          <div className="panel__body">
            <section className="section">
              <div className="section__head">
                <h2 className="section__title">Spot check</h2>
                {point && (
                  <small>
                    {point.lat.toFixed(4)}, {point.lon.toFixed(4)}
                  </small>
                )}
              </div>
              <ResultCard
                analysis={analysis}
                forecast={forecast}
                startMin={startMin}
                endMin={windowEnd}
                currentMin={currentMin}
                hasBuildings={buildings.length > 0}
                onClear={() => setPoint(null)}
              />
            </section>

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
                  setSliderMin(start)
                }}
              />
            </section>

            <section className="section">
              <div className="section__head">
                <h2 className="section__title">Sun</h2>
                <small>{formatDateLabel(date)}</small>
              </div>
              <SunArc
                date={date}
                timezone={timezone}
                lat={place.lat}
                lon={place.lon}
                startMin={startMin}
                endMin={windowEnd}
                currentMin={currentMin}
              />
            </section>

            <section className="section">
              <div className="section__head">
                <h2 className="section__title">Weather</h2>
                <small>{point ? 'at the marked spot' : 'at the map location'}</small>
              </div>
              <WeatherPanel state={forecast} currentMin={currentMin} />
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
