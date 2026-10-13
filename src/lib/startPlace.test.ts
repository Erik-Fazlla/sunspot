import { describe, expect, it } from 'vitest'
import {
  formatStartChoice,
  isStartPlace,
  parseLastPosition,
  parseStartChoice,
  startChoiceLabel,
  type StartChoice,
} from './startPlace'

const ATHENS: StartChoice = {
  mode: 'place',
  place: { lat: 37.9838, lon: 23.7275, label: 'Athens, Greece', timezone: 'Europe/Athens' },
}

describe('parseStartChoice', () => {
  it('has no choice on a first visit', () => {
    expect(parseStartChoice(null)).toBeNull()
    expect(parseStartChoice('')).toBeNull()
  })

  it('reads back what was stored', () => {
    expect(parseStartChoice(formatStartChoice({ mode: 'gps' }))).toEqual({ mode: 'gps' })
    expect(parseStartChoice(formatStartChoice(ATHENS))).toEqual(ATHENS)
  })

  it('keeps a place without a timezone', () => {
    const stored = '{"mode":"place","place":{"lat":40.6,"lon":22.9,"label":"Thessaloniki"}}'
    expect(parseStartChoice(stored)).toEqual({ mode: 'place', place: { lat: 40.6, lon: 22.9, label: 'Thessaloniki' } })
  })

  it('treats anything broken as no choice, so the question is asked again', () => {
    for (const stored of [
      'not json',
      '42',
      'null',
      '{"mode":"somewhere"}',
      '{"mode":"place"}',
      '{"mode":"place","place":{"lat":"37","lon":23,"label":"A"}}',
      '{"mode":"place","place":{"lat":137,"lon":23,"label":"A"}}',
      '{"mode":"place","place":{"lat":37,"lon":230,"label":"A"}}',
      '{"mode":"place","place":{"lat":37,"lon":23,"label":"  "}}',
      '{"mode":"place","place":{"lat":37,"lon":23}}',
    ]) {
      expect(parseStartChoice(stored)).toBeNull()
    }
  })

  it('drops fields it does not know', () => {
    const stored = '{"mode":"place","extra":1,"place":{"lat":37,"lon":23,"label":"A","id":9,"timezone":5}}'
    expect(parseStartChoice(stored)).toEqual({ mode: 'place', place: { lat: 37, lon: 23, label: 'A' } })
  })
})

describe('parseLastPosition', () => {
  it('reads a stored position', () => {
    expect(parseLastPosition('{"lat":37.98,"lon":23.73}')).toEqual({ lat: 37.98, lon: 23.73 })
  })

  it('ignores nothing, rubbish and impossible coordinates', () => {
    for (const stored of [null, '', 'x', '{}', '{"lat":"37","lon":23}', '{"lat":97,"lon":23}', 'null']) {
      expect(parseLastPosition(stored)).toBeNull()
    }
  })
})

describe('startChoiceLabel', () => {
  it('names the choice', () => {
    expect(startChoiceLabel({ mode: 'gps' })).toBe('My location')
    expect(startChoiceLabel(ATHENS)).toBe('Athens, Greece')
  })
})

describe('isStartPlace', () => {
  it('recognises the saved place and nothing else', () => {
    expect(isStartPlace(ATHENS, { lat: 37.9838, lon: 23.7275 })).toBe(true)
    expect(isStartPlace(ATHENS, { lat: 37.99, lon: 23.7275 })).toBe(false)
    expect(isStartPlace({ mode: 'gps' }, { lat: 37.9838, lon: 23.7275 })).toBe(false)
    expect(isStartPlace(null, { lat: 37.9838, lon: 23.7275 })).toBe(false)
  })
})
