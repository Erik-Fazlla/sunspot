import { useCallback, useEffect, useMemo, useState } from 'react'
import { BasemapControl, LayerToggles } from './components/LayerToggles'
import { MapView, type Basemap, type LngLat } from './components/MapView'
import { ResultCard } from './components/ResultCard'
import { SearchBox } from './components/SearchBox'
import { StartPicker } from './components/StartPicker'
import { SunArc } from './components/SunArc'
import { TimeControls } from './components/TimeControls'
import { TimeSlider } from './components/TimeSlider'
import { WeatherPanel } from './components/WeatherPanel'
import { useForecast, useTimezone } from './hooks/useForecast'
import { useStoredBoolean, useStoredChoice, useStoredNumber } from './hooks/useStoredBoolean'
import {
  DEFAULT_DATE_OFFSET_DAYS,
  DEFAULT_END_MIN,
  DEFAULT_START_MIN,
  DEFAULT_TIMEZONE,
  FALLBACK_PLACE,
  FORECAST_DAYS,
  PLAY_INTERVAL_MS,
  STEP_MINUTES,
} from './lib/constants'
import { analyzePoint } from './lib/analysis'
import { clampImageryOpacity, IMAGERY_DEFAULT_OPACITY } from './lib/imagery'
import { currentPosition, LOCATION_MESSAGES, LocationError } from './lib/location'
import {
  isStartPlace,
  readStartChoice,
  startChoiceLabel,
  writeStartChoice,
  type StartChoice,
} from './lib/startPlace'
import { hourSunFactor } from './lib/sunFactor'
import type { Place } from './lib/geocode'
import type { Building } from './lib/shadow'
import { addDays, diffDays, formatDateLabel, formatMinutes, todayInTz, zonedToUtc } from './lib/time'

type GeoState = { status: 'idle' } | { status: 'locating' } | { status: 'error'; message: string }

export default function App() {
  // Where the map opens: the user's own choice, asked for on the first visit.
  const [start, setStart] = useState<StartChoice | null>(readStartChoice)
  const [askStart, setAskStart] = useState(start === null)
  const [place, setPlace] = useState<Place>(start?.mode === 'place' ? start.place : FALLBACK_PLACE)
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' })
  // null means "the default date": tomorrow, wherever the selected place is.
  const [pickedDate, setPickedDate] = useState<string | null>(null)
  const [startMin, setStartMin] = useState(DEFAULT_START_MIN)
  const [endMin, setEndMin] = useState(DEFAULT_END_MIN)
  const [sliderMin, setSliderMin] = useState(DEFAULT_START_MIN)
  const [playing, setPlaying] = useState(false)
  const [point, setPoint] = useState<LngLat | null>(null)
  const [buildings, setBuildings] = useState<Building[]>([])
  const [panelOpen, setPanelOpen] = useState(true)
  const [showSunHours, setShowSunHours] = useStoredBoolean('sunspot:sun-hours', false)
  const [showTerrain, setShowTerrain] = useStoredBoolean('sunspot:terrain', false)
  const [showSunDirection, setShowSunDirection] = useStoredBoolean('sunspot:sun-direction', true)
  const [basemap, setBasemap] = useStoredChoice<Basemap>('sunspot:basemap', 'map', ['map', 'satellite'])
  const [storedOpacity, setImageryOpacity] = useStoredNumber('sunspot:imagery-opacity', IMAGERY_DEFAULT_OPACITY)
  const imageryOpacity = clampImageryOpacity(storedOpacity)

  // Weather and timezone follow the clicked point when there is one.
  const target = point ?? place
  const lookedUpTimezone = useTimezone(target.lat, target.lon, point ? undefined : place.timezone)
  const timezone = lookedUpTimezone ?? place.timezone ?? DEFAULT_TIMEZONE
  const today = todayInTz(timezone)
  const lastForecastDate = addDays(today, FORECAST_DAYS - 1)
  const date = pickedDate ?? addDays(today, DEFAULT_DATE_OFFSET_DAYS)
  const forecastOffset = diffDays(today, date)
  const inForecastRange = forecastOffset >= 0 && forecastOffset < FORECAST_DAYS
  const forecast = useForecast(target.lat, target.lon, date, inForecastRange)

  const locate = useCallback(() => {
    setGeo({ status: 'locating' })
    currentPosition().then(
      ({ lat, lon }) => {
        setPlace({ lat, lon, label: 'My location' })
        setGeo({ status: 'idle' })
      },
      (error: unknown) => {
        const message = error instanceof LocationError ? error.message : LOCATION_MESSAGES.unavailable
        setGeo({ status: 'error', message })
      },
    )
  }, [])

  // Opening the app only looks for the user when that is what they chose. A
  // fixed start place is already on the map, and a first visit asks first.
  useEffect(() => {
    if (start?.mode === 'gps') locate()
    // Only when the app opens; later changes go through `chooseStart`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const chooseStart = (choice: StartChoice) => {
    writeStartChoice(choice)
    setStart(choice)
    setAskStart(false)
    if (choice.mode === 'gps') locate()
    else setPlace(choice.place)
  }

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

  // sunFactor per forecast hour: how much direct beam the weather lets through.
  const readyForecast = forecast.status === 'ready' ? forecast.forecast : null
  const hourFactors = useMemo(
    () => readyForecast?.hours.map((hour) => hourSunFactor(hour, target.lat, target.lon, timezone)) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readyForecast, timezone],
  )
  const factorAt = useMemo(
    () => (hourFactors ? (minutes: number) => hourFactors[Math.floor(minutes / 60)] ?? 1 : null),
    [hourFactors],
  )
  const currentFactor = factorAt ? factorAt(currentMin) : null

  const analysis = useMemo(
    () =>
      point ? analyzePoint([point.lon, point.lat], buildings, date, startMin, windowEnd, timezone) : null,
    [point, buildings, date, startMin, windowEnd, timezone],
  )

  const isDefaultWhen = pickedDate === null && startMin === DEFAULT_START_MIN && endMin === DEFAULT_END_MIN
  const resetWhen = () => {
    setPickedDate(null)
    setStartMin(DEFAULT_START_MIN)
    setEndMin(DEFAULT_END_MIN)
    setSliderMin(DEFAULT_START_MIN)
  }

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
        date={date}
        timezone={timezone}
        windowStartMin={startMin}
        windowEndMin={windowEnd}
        sunStrength={currentFactor}
        basemap={basemap}
        imageryOpacity={imageryOpacity}
        showSunDirection={showSunDirection}
        showSunHours={showSunHours}
        showTerrain={showTerrain}
        shadeTimeLabel={formatMinutes(currentMin)}
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
                factorAt={factorAt}
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
              <p className="start-line">
                <span>
                  Opens at <strong>{start ? startChoiceLabel(start) : 'Athens until you choose'}</strong>
                </span>
                {!isStartPlace(start, place) && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() =>
                      chooseStart({
                        mode: 'place',
                        // A found position has no name of its own.
                        place: { ...place, label: place.label === 'My location' ? 'My saved spot' : place.label },
                      })
                    }
                  >
                    Open here instead
                  </button>
                )}
                <button type="button" className="link-btn" onClick={() => setAskStart(true)}>
                  Change
                </button>
              </p>
            </section>

            <section className="section">
              <div className="section__head">
                <h2 className="section__title">When</h2>
                {!isDefaultWhen && (
                  <button type="button" className="link-btn section__action" onClick={resetWhen}>
                    Reset to tomorrow 14:00–15:00
                  </button>
                )}
              </div>
              <TimeControls
                date={date}
                startMin={startMin}
                endMin={windowEnd}
                minDate={today}
                maxDate={lastForecastDate}
                message={whenMessage}
                onDateChange={setPickedDate}
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
              <WeatherPanel state={forecast} currentMin={currentMin} sunFactor={currentFactor} />
            </section>

            <section className="section">
              <h2 className="section__title">Map layers</h2>
              <BasemapControl
                basemap={basemap}
                onBasemapChange={setBasemap}
                imageryOpacity={imageryOpacity}
                onImageryOpacityChange={setImageryOpacity}
              />
              <LayerToggles
                toggles={[
                  {
                    id: 'sun-direction',
                    label: 'Sun path',
                    hint: 'The sun’s path across the sky for this day, and where its light comes from now',
                    checked: showSunDirection,
                    onChange: setShowSunDirection,
                  },
                  {
                    id: 'sun-hours',
                    label: 'Sun hours',
                    hint: 'Colours the ground by how long it is in the sun during your time window',
                    checked: showSunHours,
                    onChange: setShowSunHours,
                  },
                  {
                    id: 'terrain',
                    label: '3D terrain',
                    hint: 'Approximate relief at true scale (coarse 30 m data); shadows assume flat ground',
                    checked: showTerrain,
                    onChange: setShowTerrain,
                  },
                ]}
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
              </a>{' '}
              · terrain by{' '}
              <a
                href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md"
                target="_blank"
                rel="noreferrer"
              >
                Mapzen, AWS Terrain Tiles
              </a>{' '}
              · satellite imagery powered by{' '}
              <a href="https://www.esri.com" target="_blank" rel="noreferrer">
                Esri
              </a>{' '}
              (Esri, Maxar, Earthstar Geographics, and the GIS User Community)
            </footer>
          </div>
        </div>
      </aside>

      {askStart && <StartPicker current={start} onChoose={chooseStart} onClose={() => setAskStart(false)} />}
    </div>
  )
}
