import type { CSSProperties } from 'react'
import { IMAGERY_MIN_OPACITY } from '../lib/imagery'
import type { Basemap } from './MapView'

export interface LayerToggle {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}

/** On/off switches for optional map layers. */
export function LayerToggles({ toggles }: { toggles: LayerToggle[] }) {
  return (
    <div className="toggles">
      {toggles.map((toggle) => (
        <label key={toggle.id} className="toggle">
          <input
            type="checkbox"
            role="switch"
            checked={toggle.checked}
            onChange={(event) => toggle.onChange(event.target.checked)}
          />
          <span className="toggle__track" aria-hidden="true" />
          <span className="toggle__text">
            <strong>{toggle.label}</strong>
            <small>{toggle.hint}</small>
          </span>
        </label>
      ))}
    </div>
  )
}

const BASEMAPS: { id: Basemap; label: string }[] = [
  { id: 'map', label: 'Map' },
  { id: 'satellite', label: 'Satellite' },
]

interface BasemapControlProps {
  basemap: Basemap
  onBasemapChange: (basemap: Basemap) => void
  /** Opacity of the satellite photo, IMAGERY_MIN_OPACITY to 1. */
  imageryOpacity: number
  onImageryOpacityChange: (opacity: number) => void
}

/** Map / Satellite switch, with an opacity slider for the photo while it is shown. */
export function BasemapControl({
  basemap,
  onBasemapChange,
  imageryOpacity,
  onImageryOpacityChange,
}: BasemapControlProps) {
  const percent = Math.round(imageryOpacity * 100)
  const fill = ((imageryOpacity - IMAGERY_MIN_OPACITY) / (1 - IMAGERY_MIN_OPACITY)) * 100
  return (
    <div className="basemap">
      <div className="segmented" role="radiogroup" aria-label="Basemap">
        {BASEMAPS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={basemap === option.id}
            className={`segmented__option${basemap === option.id ? ' is-active' : ''}`}
            onClick={() => onBasemapChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {basemap === 'satellite' && (
        <label className="opacity">
          <span className="opacity__label">
            <span>Photo strength</span>
            <strong>{percent}%</strong>
          </span>
          <input
            type="range"
            min={IMAGERY_MIN_OPACITY}
            max={1}
            step={0.05}
            value={imageryOpacity}
            style={{ '--fill': `${fill}%` } as CSSProperties}
            onChange={(event) => onImageryOpacityChange(Number(event.target.value))}
          />
          <small>100% shows the untouched photo. Lower values mute it so the blue shade stands out.</small>
        </label>
      )}
    </div>
  )
}
