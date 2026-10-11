import type { CSSProperties } from 'react'
import { STEP_MINUTES } from '../lib/constants'
import { formatMinutes } from '../lib/time'

interface Props {
  startMin: number
  endMin: number
  value: number
  playing: boolean
  onChange: (minutes: number) => void
  onTogglePlay: () => void
}

export function TimeSlider({ startMin, endMin, value, playing, onChange, onTogglePlay }: Props) {
  const fill = endMin > startMin ? ((value - startMin) / (endMin - startMin)) * 100 : 0
  return (
    <div className="slider">
      <button
        type="button"
        className="slider__play"
        onClick={onTogglePlay}
        aria-label={playing ? 'Pause animation' : 'Play animation'}
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="currentColor">
          {playing ? <path d="M5 3.5h3.5v13H5zM11.5 3.5H15v13h-3.5z" /> : <path d="M6 3.2 16.5 10 6 16.8z" />}
        </svg>
      </button>
      <div className="slider__track">
        <input
          type="range"
          min={startMin}
          max={endMin}
          step={STEP_MINUTES}
          value={value}
          aria-label="Time within the window"
          aria-valuetext={formatMinutes(value)}
          style={{ '--fill': `${fill}%` } as CSSProperties}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <div className="slider__ends">
          <span>{formatMinutes(startMin)}</span>
          <span>{formatMinutes(endMin)}</span>
        </div>
      </div>
      <output className="slider__time">{formatMinutes(value)}</output>
    </div>
  )
}
