import { describe, expect, it } from 'vitest'
import { failureDetail, LOCATION_MESSAGES, LocationError, locationFailure } from './location'

describe('locationFailure', () => {
  it('reads a browser permission refusal (code 1) as denied', () => {
    expect(locationFailure({ code: 1, message: 'User denied Geolocation' })).toBe('denied')
    expect(locationFailure({ code: 1 })).toBe('denied')
  })

  it('reads a refused Android permission as denied', () => {
    expect(locationFailure(new Error('Location permission was denied'))).toBe('denied')
  })

  it('tells a switched-off location service apart from a refusal', () => {
    expect(locationFailure(new Error('Location services are not enabled'))).toBe('switched-off')
    expect(locationFailure(new Error('Location services are disabled'))).toBe('switched-off')
  })

  it('reads timeouts and everything else as unavailable', () => {
    expect(locationFailure({ code: 3, message: 'Timeout expired' })).toBe('unavailable')
    expect(locationFailure({ code: 2, message: 'Position unavailable' })).toBe('unavailable')
    expect(locationFailure(null)).toBe('unavailable')
    expect(locationFailure('nope')).toBe('unavailable')
  })
})

describe('the Android plugin’s own errors', () => {
  it('are sorted into the same three reasons', () => {
    expect(locationFailure(new Error('Location permission request was denied.'))).toBe('denied')
    expect(locationFailure(new Error('Location services are not enabled.'))).toBe('switched-off')
    expect(locationFailure(new Error('Could not obtain location in time. Try with a higher timeout.'))).toBe('unavailable')
  })

  it('keep their wording as the detail', () => {
    expect(failureDetail(new Error(' Could not obtain location in time. '))).toBe('Could not obtain location in time.')
    expect(failureDetail({ code: 3 })).toBeNull()
    expect(failureDetail(null)).toBeNull()
    expect(new LocationError('unavailable', 'timed out').detail).toBe('timed out')
    expect(new LocationError('denied').detail).toBeNull()
  })
})

describe('LocationError', () => {
  it('carries the reason and the text shown to the user', () => {
    const error = new LocationError('switched-off')
    expect(error.reason).toBe('switched-off')
    expect(error.message).toBe(LOCATION_MESSAGES['switched-off'])
    expect(error.message).toContain('switched off')
  })

  it('has a different message for each reason', () => {
    expect(new Set(Object.values(LOCATION_MESSAGES)).size).toBe(3)
  })
})
