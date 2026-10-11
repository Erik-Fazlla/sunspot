// All user-facing dates and times are wall-clock values in the *place's* IANA
// timezone. They are converted to UTC instants only at the edges (sun maths),
// so UTC and local time never get mixed.

const partsFormatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsFormatters.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsFormatters.set(timeZone, fmt)
  }
  return fmt
}

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallClock(instant: Date, timeZone: string): WallClock {
  const out: Record<string, number> = {}
  for (const part of partsFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value)
  }
  return out as unknown as WallClock
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (Athens summer = +180). */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000)
}

/** UTC instant for a wall-clock date (YYYY-MM-DD) + minutes after midnight in `timeZone`. */
export function zonedToUtc(dateStr: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  const naive = Date.UTC(y, m - 1, d, 0, minutes)
  // Two passes so the offset is the one in force at the target time, which
  // matters on days when daylight saving time starts or ends.
  const first = naive - tzOffsetMinutes(new Date(naive), timeZone) * 60000
  const offset = tzOffsetMinutes(new Date(first), timeZone)
  return new Date(naive - offset * 60000)
}

/** Today's date (YYYY-MM-DD) as seen in `timeZone`. */
export function todayInTz(timeZone: string, now: Date = new Date()): string {
  const w = wallClock(now, timeZone)
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function diffDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

export function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !Number.isNaN(Date.parse(`${dateStr}T00:00:00Z`))
}

/** 870 -> "14:30" */
export function formatMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/** "14:30" -> 870, or null when the input is empty or malformed. */
export function parseTimeInput(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes >= 0 && minutes < 1440 ? minutes : null
}

/** Clock time (HH:MM) of a UTC instant as seen in `timeZone`. */
export function formatTimeInTz(instant: Date, timeZone: string): string {
  const w = wallClock(instant, timeZone)
  return `${pad(w.hour)}:${pad(w.minute)}`
}

/** "Mon 12 Oct" for a YYYY-MM-DD date. */
export function formatDateLabel(dateStr: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${dateStr}T12:00:00Z`))
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
