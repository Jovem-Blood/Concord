import { describe, expect, it } from 'vitest'
import { avatarUrl } from './avatar'

describe('avatarUrl', () => {
  it('uses the participant name as an encoded deterministic seed', () => {
    expect(avatarUrl('  Ana & José  ')).toContain('&seed=Ana%20%26%20Jos%C3%A9')
  })

  it('uses a stable preview seed while the name is empty', () => {
    expect(avatarUrl('')).toBe(avatarUrl('   '))
  })
})
