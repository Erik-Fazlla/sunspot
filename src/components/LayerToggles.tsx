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
