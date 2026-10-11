import { formatMinutes, parseTimeInput } from '../lib/time'

interface Props {
  date: string
  startMin: number
  endMin: number
  minDate: string
  maxDate: string
  /** Validation or forecast-range message; null when everything is fine. */
  message: string | null
  onDateChange: (date: string) => void
  onWindowChange: (startMin: number, endMin: number) => void
}

export function TimeControls({
  date,
  startMin,
  endMin,
  minDate,
  maxDate,
  message,
  onDateChange,
  onWindowChange,
}: Props) {
  return (
    <div className="when">
      <div className="when__grid">
        <label className="field field--date">
          <span>Date</span>
          <input
            type="date"
            value={date}
            min={minDate}
            max={maxDate}
            onChange={(event) => {
              if (event.target.value) onDateChange(event.target.value)
            }}
          />
        </label>
        <label className="field">
          <span>From</span>
          <input
            type="time"
            step={300}
            value={formatMinutes(startMin)}
            onChange={(event) => {
              const minutes = parseTimeInput(event.target.value)
              if (minutes !== null) onWindowChange(minutes, endMin)
            }}
          />
        </label>
        <label className="field">
          <span>To</span>
          <input
            type="time"
            step={300}
            value={formatMinutes(endMin)}
            onChange={(event) => {
              const minutes = parseTimeInput(event.target.value)
              if (minutes !== null) onWindowChange(startMin, minutes)
            }}
          />
        </label>
      </div>
      {message && (
        <p className="note note--warn" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
