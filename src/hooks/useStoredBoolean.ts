import { useCallback, useState } from 'react'

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    // Storage can be blocked (private mode, embedded frames); use the default.
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // The setting still applies for this visit.
  }
}

/** A setting remembered in localStorage under `key`, with its own text form. */
function useStored<T>(
  key: string,
  fallback: T,
  parse: (stored: string) => T | null,
  format: (value: T) => string,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readStored(key)
    return (stored === null ? null : parse(stored)) ?? fallback
  })
  const update = useCallback(
    (next: T) => {
      setValue(next)
      writeStored(key, format(next))
    },
    // `format` is a constant function at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  return [value, update]
}

/** A boolean setting, stored as "1" or "0". */
export function useStoredBoolean(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  return useStored(
    key,
    fallback,
    (stored) => (stored === '1' ? true : stored === '0' ? false : null),
    (value) => (value ? '1' : '0'),
  )
}

/** One of a fixed set of words; anything else in storage falls back to the default. */
export function useStoredChoice<T extends string>(
  key: string,
  fallback: T,
  choices: readonly T[],
): [T, (value: T) => void] {
  return useStored<T>(
    key,
    fallback,
    (stored) => (choices.includes(stored as T) ? (stored as T) : null),
    (value) => value,
  )
}

/** A number setting; unreadable values fall back to the default. */
export function useStoredNumber(key: string, fallback: number): [number, (value: number) => void] {
  return useStored(
    key,
    fallback,
    (stored) => {
      const parsed = Number.parseFloat(stored)
      return Number.isFinite(parsed) ? parsed : null
    },
    (value) => String(value),
  )
}
