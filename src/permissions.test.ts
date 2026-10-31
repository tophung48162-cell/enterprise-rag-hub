import { describe, expect, it, vi } from 'vitest'

import {
  ROLE_STORAGE_KEY,
  canAccessPath,
  getAccessibleMenuItems,
  getDefaultRoute,
  normalizeRole,
  persistRole,
  readStoredRole,
} from './permissions'

describe('role normalization and storage', () => {
  it.each(['admin', 'manager', 'user'] as const)(
    'accepts the supported role %s',
    (role) => {
      expect(normalizeRole(role)).toBe(role)
    },
  )

  it.each([undefined, null, '', 'owner', 1, {}])(
    'falls back to user for an invalid value',
    (value) => {
      expect(normalizeRole(value)).toBe('user')
    },
  )

  it('reads a valid role from storage', () => {
    const storage = { getItem: vi.fn(() => 'manager') }

    expect(readStoredRole(storage)).toBe('manager')
    expect(storage.getItem).toHaveBeenCalledWith(ROLE_STORAGE_KEY)
  })

  it('uses the least privileged role for damaged or unavailable storage', () => {
    expect(readStoredRole({ getItem: () => 'super-admin' })).toBe('user')
    expect(readStoredRole(null)).toBe('user')
    expect(readStoredRole({ getItem: () => { throw new Error('denied') } })).toBe(
      'user',
    )
  })

  it('persists role changes without surfacing storage failures', () => {
    const storage = { setItem: vi.fn() }
    expect(persistRole('admin', storage)).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(ROLE_STORAGE_KEY, 'admin')

    expect(
      persistRole('user', {
        setItem: () => {
          throw new Error('quota exceeded')
        },
      }),
    ).toBe(false)
  })
})

describe('menu permissions', () => {
  it('gives administrators access to all management and usage modules', () => {
    expect(getAccessibleMenuItems('admin').map((item) => item.path)).toEqual([
      '/workbench',
      '/models',
      '/knowledge',
      '/applications',
      '/chat',
      '/logs',
      '/observability',
    ])
  })

  it('hides model service from knowledge base managers', () => {
    expect(getAccessibleMenuItems('manager').map((item) => item.path)).toEqual([
      '/workbench',
      '/knowledge',
      '/applications',
      '/chat',
      '/logs',
      '/observability',
    ])
  })

  it('shows usage modules without management controls to users', () => {
    expect(getAccessibleMenuItems('user').map((item) => item.path)).toEqual([
      '/workbench',
      '/applications',
      '/chat',
    ])
  })
})

describe('route permissions', () => {
  it('allows authorized nested routes, query strings, hashes, and trailing slashes', () => {
    expect(canAccessPath('manager', '/knowledge/company-policy')).toBe(true)
    expect(canAccessPath('manager', '/logs/?status=failed#detail')).toBe(true)
    expect(canAccessPath('manager', '/observability/runs/run-chat-031?tab=context')).toBe(true)
    expect(canAccessPath('user', '/chat/session-1?source=home')).toBe(true)
  })

  it('rejects restricted and unknown routes', () => {
    expect(canAccessPath('manager', '/models')).toBe(false)
    expect(canAccessPath('user', '/knowledge')).toBe(false)
    expect(canAccessPath('user', '/logs')).toBe(false)
    expect(canAccessPath('user', '/observability/runs/run-chat-031')).toBe(false)
    expect(canAccessPath('admin', '/settings')).toBe(false)
    expect(canAccessPath('user', '/chatty')).toBe(false)
  })

  it('opens the role-aware workbench for every supported role', () => {
    expect(canAccessPath('user', '/')).toBe(true)
    expect(getDefaultRoute('admin')).toBe('/workbench')
    expect(getDefaultRoute('manager')).toBe('/workbench')
    expect(getDefaultRoute('user')).toBe('/workbench')
  })
})
