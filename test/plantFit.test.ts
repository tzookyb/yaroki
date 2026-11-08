import { describe, expect, it } from 'vitest'
import { humidityFit, lightFit, temperatureFit } from '../shared/plantFit'

describe('lightFit', () => {
  it.each([
    ['direct', 'low', 'low'],
    ['bright_indirect', 'low', 'low'],
    ['bright_indirect', 'bright_indirect', 'ok'],
    ['bright_indirect', 'direct', 'ok'],
    ['medium', 'bright_indirect', 'ok'],
    ['medium', 'direct', 'high'],
    ['low', 'bright_indirect', 'high'],
  ] as const)('plant needs %s, room has %s: %s', (needs, has, fit) => {
    expect(lightFit({ light_needs: needs }, { light_level: has })).toBe(fit)
  })

  it('is unknown when the room level is not set', () => {
    expect(lightFit({ light_needs: 'low' }, { light_level: null })).toBeNull()
  })
})

describe('humidityFit', () => {
  it('compares plant needs with the room', () => {
    expect(humidityFit({ humidity_needs: 'humid' }, { humidity: 'dry' })).toBe(
      'low',
    )
    expect(humidityFit({ humidity_needs: 'dry' }, { humidity: 'humid' })).toBe(
      'high',
    )
    expect(
      humidityFit({ humidity_needs: 'normal' }, { humidity: 'normal' }),
    ).toBe('ok')
    expect(
      humidityFit({ humidity_needs: null }, { humidity: 'dry' }),
    ).toBeNull()
  })
})

describe('temperatureFit', () => {
  const plant = { temp_min: 15, temp_max: 25 }

  it('flags a room that gets colder or hotter than the plant likes', () => {
    expect(temperatureFit(plant, { temp_min: 10, temp_max: 22 })).toBe('low')
    expect(temperatureFit(plant, { temp_min: 18, temp_max: 30 })).toBe('high')
    expect(temperatureFit(plant, { temp_min: 18, temp_max: 24 })).toBe('ok')
  })

  it('works with one side of the room range', () => {
    expect(temperatureFit(plant, { temp_min: 18, temp_max: null })).toBe('ok')
  })

  it('is unknown without a room range or plant range', () => {
    expect(temperatureFit(plant, { temp_min: null, temp_max: null })).toBeNull()
    expect(
      temperatureFit(
        { temp_min: null, temp_max: null },
        { temp_min: 18, temp_max: 24 },
      ),
    ).toBeNull()
  })
})
