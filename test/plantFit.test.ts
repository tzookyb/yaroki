import { describe, expect, it } from 'vitest'
import { humidityFit, lightFit, temperatureFit } from '../shared/plantFit'

const result = (fit: ReturnType<typeof lightFit>) =>
  fit && [fit.verdict, fit.direction]

describe('lightFit', () => {
  it.each([
    ['direct', 'low', ['bad', 'low']],
    ['direct', 'bright_indirect', ['warn', 'low']],
    ['bright_indirect', 'low', ['bad', 'low']],
    ['bright_indirect', 'bright_indirect', ['good', null]],
    ['bright_indirect', 'direct', ['good', null]],
    ['medium', 'low', ['warn', 'low']],
    ['medium', 'bright_indirect', ['good', null]],
    ['medium', 'direct', ['warn', 'high']],
    ['low', 'bright_indirect', ['warn', 'high']],
    ['low', 'direct', ['bad', 'high']],
  ])('plant needs %s, room has %s', (needs, has, expected) => {
    expect(
      result(lightFit({ light_needs: needs }, { light_level: has as 'low' })),
    ).toEqual(expected)
  })

  it('is unknown when the room level is not set', () => {
    expect(lightFit({ light_needs: 'low' }, { light_level: null })).toBeNull()
  })
})

describe('humidityFit', () => {
  it('compares the room profile levels', () => {
    expect(
      result(humidityFit({ humidity_needs: 'humid' }, { humidity: 'dry' })),
    ).toEqual(['bad', 'low'])
    expect(
      result(humidityFit({ humidity_needs: 'dry' }, { humidity: 'normal' })),
    ).toEqual(['warn', 'high'])
    expect(
      result(humidityFit({ humidity_needs: 'normal' }, { humidity: 'normal' })),
    ).toEqual(['good', null])
  })

  it('prefers a measured value over the profile', () => {
    const plant = { humidity_needs: 'normal' as const }
    const room = { humidity: 'dry' as const }
    expect(humidityFit(plant, room, { humidity: 50 })).toMatchObject({
      verdict: 'good',
      source: 'reading',
    })
    expect(result(humidityFit(plant, room, { humidity: 33 }))).toEqual([
      'warn',
      'low',
    ])
    expect(result(humidityFit(plant, room, { humidity: 20 }))).toEqual([
      'bad',
      'low',
    ])
    expect(result(humidityFit(plant, room, { humidity: 80 }))).toEqual([
      'bad',
      'high',
    ])
  })

  it('falls back to the profile when the reading has no humidity', () => {
    expect(
      humidityFit(
        { humidity_needs: 'normal' },
        { humidity: 'normal' },
        { humidity: null },
      ),
    ).toMatchObject({ source: 'profile' })
  })

  it('is unknown without data', () => {
    expect(
      humidityFit({ humidity_needs: null }, { humidity: 'dry' }),
    ).toBeNull()
    expect(
      humidityFit({ humidity_needs: 'dry' }, { humidity: null }),
    ).toBeNull()
  })
})

describe('temperatureFit', () => {
  const plant = { temp_min: 15, temp_max: 25 }
  const room = (temp_min: number | null, temp_max: number | null) => ({
    temp_min,
    temp_max,
  })

  it('grades a room range by how far it leaves the plant range', () => {
    expect(result(temperatureFit(plant, room(18, 24)))).toEqual(['good', null])
    expect(result(temperatureFit(plant, room(13, 22)))).toEqual(['warn', 'low'])
    expect(result(temperatureFit(plant, room(10, 22)))).toEqual(['bad', 'low'])
    expect(result(temperatureFit(plant, room(18, 27)))).toEqual([
      'warn',
      'high',
    ])
    expect(result(temperatureFit(plant, room(18, 30)))).toEqual(['bad', 'high'])
  })

  it('works with one side of the room range', () => {
    expect(result(temperatureFit(plant, room(18, null)))).toEqual([
      'good',
      null,
    ])
  })

  it('prefers a measured temperature over the profile', () => {
    expect(
      temperatureFit(plant, room(10, 22), { temperature: 20 }),
    ).toMatchObject({ verdict: 'good', source: 'reading' })
    expect(
      result(temperatureFit(plant, room(18, 24), { temperature: 29 })),
    ).toEqual(['bad', 'high'])
  })

  it('is unknown without a room range or plant range', () => {
    expect(temperatureFit(plant, room(null, null))).toBeNull()
    expect(
      temperatureFit({ temp_min: null, temp_max: null }, room(18, 24)),
    ).toBeNull()
  })
})
