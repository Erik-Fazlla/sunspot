import { describe, expect, it } from 'vitest'
import {
  addDays,
  diffDays,
  formatMinutes,
  formatTimeInTz,
  isValidDate,
  parseTimeInput,
  todayInTz,
  tzOffsetMinutes,
  zonedToUtc,
} from './time'

describe('zonedToUtc', () => {
  it('converts Athens wall-clock time to UTC in summer (UTC+3) and winter (UTC+2)', () => {
    expect(zonedToUtc('2026-07-15', 14 * 60, 'Europe/Athens').toISOString()).toBe('2026-07-15T11:00:00.000Z')
    expect(zonedToUtc('2026-01-15', 14 * 60, 'Europe/Athens').toISOString()).toBe('2026-01-15T12:00:00.000Z')
  })

  it('uses the offset in force on the day daylight saving time ends', () => {
    // Clocks go back at 04:00 local on 25 Oct 2026.
    expect(zonedToUtc('2026-10-25', 2 * 60, 'Europe/Athens').toISOString()).toBe('2026-10-24T23:00:00.000Z')
    expect(zonedToUtc('2026-10-25', 14 * 60, 'Europe/Athens').toISOString()).toBe('2026-10-25T12:00:00.000Z')
  })

  it('handles timezones west of UTC and half-hour offsets', () => {
    expect(zonedToUtc('2026-07-15', 9 * 60, 'America/New_York').toISOString()).toBe('2026-07-15T13:00:00.000Z')
    expect(zonedToUtc('2026-07-15', 9 * 60, 'Asia/Kolkata').toISOString()).toBe('2026-07-15T03:30:00.000Z')
  })

  it('round-trips through formatTimeInTz', () => {
    const instant = zonedToUtc('2026-10-12', 14 * 60 + 35, 'Europe/Athens')
    expect(formatTimeInTz(instant, 'Europe/Athens')).toBe('14:35')
  })
})

describe('timezone helpers', () => {
  it('reports the UTC offset in minutes', () => {
    expect(tzOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Europe/Athens')).toBe(180)
    expect(tzOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Europe/Athens')).toBe(120)
  })

  it('finds the local calendar date, which can differ from the UTC date', () => {
    const lateEvening = new Date('2026-10-11T22:30:00Z')
    expect(todayInTz('Europe/Athens', lateEvening)).toBe('2026-10-12')
    expect(todayInTz('America/Los_Angeles', lateEvening)).toBe('2026-10-11')
  })
})

describe('date and time formatting', () => {
  it('adds and subtracts days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(diffDays('2026-10-11', '2026-10-27')).toBe(16)
    expect(diffDays('2026-10-11', '2026-10-10')).toBe(-1)
  })

  it('formats and parses clock times', () => {
    expect(formatMinutes(870)).toBe('14:30')
    expect(formatMinutes(5)).toBe('00:05')
    expect(parseTimeInput('14:30')).toBe(870)
    expect(parseTimeInput('09:05:00')).toBe(545)
    expect(parseTimeInput('')).toBeNull()
    expect(parseTimeInput('25:00')).toBeNull()
  })

  it('validates date strings', () => {
    expect(isValidDate('2026-10-12')).toBe(true)
    expect(isValidDate('12/10/2026')).toBe(false)
  })
})
