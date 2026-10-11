import { useEffect, useRef, useState } from 'react'
import { searchPlaces, type Place, type PlaceResult } from '../lib/geocode'

const SEARCH_DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; results: PlaceResult[] }

interface Props {
  onSelect: (place: Place) => void
  onLocate: () => void
  locating: boolean
  locateMessage: string | null
}

export function SearchBox({ onSelect, onLocate, locating, locateMessage }: Props) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setState({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setState({ status: 'loading' })
      searchPlaces(trimmed, controller.signal)
        .then((results) => setState({ status: 'ready', results }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          const message = error instanceof Error ? error.message : 'Place search failed'
          setState({ status: 'error', message })
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, attempt])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const choose = (result: PlaceResult) => {
    onSelect({
      lat: result.lat,
      lon: result.lon,
      label: result.detail ? `${result.label}, ${result.detail}` : result.label,
      timezone: result.timezone,
    })
    setQuery('')
    setOpen(false)
  }

  const showList = open && state.status !== 'idle'

  return (
    <div className="search" ref={rootRef}>
      <div className="search__row">
        <label className="search__field">
          <span className="visually-hidden">Search for a place</span>
          <SearchIcon />
          <input
            type="search"
            value={query}
            placeholder="Search a city or area"
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false)
              if (event.key === 'Enter' && state.status === 'ready' && state.results[0]) {
                choose(state.results[0])
              }
            }}
          />
        </label>
        <button
          type="button"
          className="icon-btn"
          onClick={onLocate}
          disabled={locating}
          aria-label="Use my location"
          title="Use my location"
        >
          {locating ? <span className="spinner" aria-hidden="true" /> : <LocateIcon />}
        </button>
      </div>

      {showList && (
        <div className="search__list" role="listbox" aria-label="Places">
          {state.status === 'loading' && <p className="search__status">Searching…</p>}
          {state.status === 'error' && (
            <p className="search__status search__status--error">
              {state.message}.{' '}
              <button type="button" className="link-btn" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </p>
          )}
          {state.status === 'ready' && state.results.length === 0 && (
            <p className="search__status">No places match “{query.trim()}”.</p>
          )}
          {state.status === 'ready' &&
            state.results.map((result) => (
              <button
                type="button"
                key={result.id}
                role="option"
                aria-selected="false"
                className="search__option"
                onClick={() => choose(result)}
              >
                <span>{result.label}</span>
                <small>{result.detail}</small>
              </button>
            ))}
        </div>
      )}

      {locateMessage && <p className="note note--warn">{locateMessage}</p>}
    </div>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m13.5 13.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function LocateIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="10" cy="10" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="10" cy="10" r="1.8" fill="currentColor" />
      <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
