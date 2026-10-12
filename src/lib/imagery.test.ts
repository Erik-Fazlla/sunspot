import { describe, expect, it } from 'vitest'
import {
  clampImageryOpacity,
  ESRI_ATTRIBUTION,
  esriImageryTileUrl,
  IMAGERY_DEFAULT_OPACITY,
  IMAGERY_MIN_OPACITY,
} from './imagery'

describe('esriImageryTileUrl', () => {
  it('uses the keyless endpoint when no key is set', () => {
    for (const key of [undefined, null, '', '   ']) {
      const url = esriImageryTileUrl(key)
      expect(url).toBe(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      )
      expect(url).not.toContain('token')
    }
  })

  it('appends the key as a token to every tile request when one is set', () => {
    const url = esriImageryTileUrl(' AAPK-test-key ')
    expect(url).toBe(
      'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=AAPK-test-key',
    )
  })

  it('escapes characters that would break the URL', () => {
    expect(esriImageryTileUrl('a b&c')).toContain('?token=a%20b%26c')
  })

  it('keeps the row-before-column tile order Esri uses', () => {
    expect(esriImageryTileUrl()).toMatch(/\{z\}\/\{y\}\/\{x\}$/)
  })
})

describe('clampImageryOpacity', () => {
  it('keeps values inside the allowed range', () => {
    expect(clampImageryOpacity(0.6)).toBe(0.6)
    expect(clampImageryOpacity(1)).toBe(1)
    expect(clampImageryOpacity(2)).toBe(1)
    expect(clampImageryOpacity(0)).toBe(IMAGERY_MIN_OPACITY)
  })

  it('falls back to the default for a broken stored value', () => {
    expect(clampImageryOpacity(Number.NaN)).toBe(IMAGERY_DEFAULT_OPACITY)
  })
})

describe('ESRI_ATTRIBUTION', () => {
  it('credits Esri and its imagery providers', () => {
    expect(ESRI_ATTRIBUTION).toContain('Powered by')
    expect(ESRI_ATTRIBUTION).toContain('Esri')
    expect(ESRI_ATTRIBUTION).toContain('Maxar')
  })
})
