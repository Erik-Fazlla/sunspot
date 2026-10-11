import { useCallback, useState } from 'react'

function read(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key)
    return stored === null ? fallback : stored === '1'
  } catch {
    // Storage can be blocked (private mode, embedded frames); use the default.
    return fallback
  }
}

/** A boolean setting remembered in localStorage under `key` ("1" or "0"). */
export function useStoredBoolean(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => read(key, fallback))
  const update = useCallback(
    (next: boolean) => {
      setValue(next)
      try {
        window.localStorage.setItem(key, next ? '1' : '0')
      } catch {
        // The setting still applies for this visit.
      }
    },
    [key],
  )
  return [value, update]
}
