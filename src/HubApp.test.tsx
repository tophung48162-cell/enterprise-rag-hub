// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App as AntApp, ConfigProvider } from 'antd'
import { MemoryRouter } from 'react-router-dom'
import HubApp from './HubApp'
import { STORE_KEY } from './workspace'

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, media: '', onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } }))
  window.getComputedStyle = vi.fn(window.getComputedStyle.bind(window))
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn(() => Promise.resolve()) })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers() })

describe('online conversation workflow', () => {
  it('finishes a question, renders citations and persists a matching usage log', async () => {
    vi.useFakeTimers()
    render(<ConfigProvider theme={{ token: { motion: false } }}><AntApp><MemoryRouter initialEntries={['/chat?assistant=food-assistant']}><HubApp /></MemoryRouter></AntApp></ConfigProvider>)
    fireEvent.click(screen.getByRole('button', { name: /过桥米线有哪些主要食材/ }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    expect(screen.getByText(/根据「过桥米线」中的资料/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /\[1\].*云南传统名菜百科/ })).toBeTruthy()
    const saved = JSON.parse(localStorage.getItem(STORE_KEY)!)
    expect(saved.sessions[0].messages).toHaveLength(2)
    expect(saved.logs[0].query).toBe('过桥米线有哪些主要食材？')
    expect(saved.logs[0].input + saved.logs[0].output).toBe(saved.sessions[0].messages[1].tokens)
  })
})
