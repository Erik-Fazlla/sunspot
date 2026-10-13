import { formatBytes, savedPlaceId, type SavedPlace } from '../lib/savedPlaces'

interface Props {
  saved: SavedPlace[]
  /** The middle of the map: the spot a save would cover. */
  centre: { lat: number; lon: number }
  /** Files done and files in all while a save is running; null otherwise. */
  saving: { done: number; total: number } | null
  error: string | null
  online: boolean
  onSave: () => void
  onOpen: (place: SavedPlace) => void
  onRemove: (place: SavedPlace) => void
}

const savedOn = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** Save the area on the map for use without a connection, and open or remove saved ones. */
export function SavedPlaces({ saved, centre, saving, error, online, onSave, onOpen, onRemove }: Props) {
  const here = saved.find((place) => place.id === savedPlaceId(centre.lat, centre.lon))
  const percent = saving && saving.total > 0 ? Math.round((saving.done / saving.total) * 100) : 0

  return (
    <div className="saved">
      <button type="button" className="saved__save" onClick={onSave} disabled={saving !== null || !online}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path
            d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 15.5h12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {saving
          ? `Saving… ${saving.done} of ${saving.total}`
          : here
            ? 'Saved for offline · save again'
            : 'Save this place for offline'}
      </button>
      {saving && (
        <div className="saved__bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${percent}%` }} />
        </div>
      )}
      <p className="saved__hint">
        Keeps the map, the buildings and a 7-day forecast for about 1 km around the middle of the map on this device.
      </p>
      {!online && <p className="note note--warn">No connection. Only saved places have a map, and search is off.</p>}
      {error && (
        <p className="note note--error" role="alert">
          {error}
        </p>
      )}

      {saved.length > 0 && (
        <ul className="saved__list" aria-label="Saved places">
          {saved.map((place) => (
            <li key={place.id} className={place === here ? 'is-here' : undefined}>
              <button type="button" className="saved__open" onClick={() => onOpen(place)}>
                <span>{place.label}</span>
                <small>
                  saved {savedOn(place.savedAt)} · {formatBytes(place.bytes)}
                </small>
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--ghost saved__remove"
                onClick={() => onRemove(place)}
                aria-label={`Remove ${place.label}`}
                title="Remove"
              >
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                  <path d="m5.5 5.5 9 9m0-9-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
