import { startChoiceLabel, type StartChoice } from '../lib/startPlace'
import { SearchBox } from './SearchBox'

interface Props {
  /** The choice in force now; null the first time the app is opened. */
  current: StartChoice | null
  onChoose: (choice: StartChoice) => void
  /** Leave without choosing. */
  onClose: () => void
}

/**
 * Asks where the map should open each time: wherever the user is, or one
 * place they pick. Shown once on the first visit and again from "Where".
 */
export function StartPicker({ current, onChoose, onClose }: Props) {
  const useLocation = () => onChoose({ mode: 'gps' })
  return (
    <div className="start" role="dialog" aria-modal="true" aria-labelledby="start-title">
      <div className="start__card">
        <span className="brand__mark start__mark" aria-hidden="true" />
        <h2 id="start-title">Where should Sunspot open?</h2>
        <p className="start__lead">
          Choose what the map shows every time you open the app. You can change it later under “Where”.
        </p>

        <button type="button" className="start__option" onClick={useLocation}>
          <svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true">
            <circle cx="10" cy="10" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="10" cy="10" r="1.8" fill="currentColor" />
            <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span>
            <strong>Where I am</strong>
            <small>Finds your location each time the app opens</small>
          </span>
        </button>

        <p className="start__or">or always open at one place</p>
        <SearchBox
          onSelect={(place) => onChoose({ mode: 'place', place })}
          onLocate={useLocation}
          locating={false}
          locateMessage={null}
        />

        <button type="button" className="link-btn start__skip" onClick={onClose}>
          {current ? `Keep “${startChoiceLabel(current)}”` : 'Decide later'}
        </button>
      </div>
    </div>
  )
}
