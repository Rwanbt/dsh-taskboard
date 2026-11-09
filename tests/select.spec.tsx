// @vitest-environment jsdom
/**
 * Focused behavioural tests for the themed {@link Select} control (the native
 * `<select>` replacement): WAI-ARIA combobox semantics, keyboard navigation,
 * typeahead, disabled rows, portal placement and outside-click/Escape close.
 *
 * These assert observable behaviour (attributes, DOM presence, focus, calls),
 * never whole-DOM snapshots.
 *
 * @module dsh-taskboard/tests/select
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Select, type SelectOption } from '../src/client/board/Select.tsx'

const cleanup: Array<() => void> = []

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  cleanup.splice(0).reverse().forEach(fn => fn())
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

/** Render the control and return its host + a change spy. */
function mount(options: readonly SelectOption[], props: Partial<Parameters<typeof Select>[0]> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup.push(() => { root.unmount(); host.remove() })
  const onChange = vi.fn()
  const render = (next: Partial<Parameters<typeof Select>[0]> = {}): void => {
    root.render(
      <Select
        value=""
        onChange={onChange}
        options={options}
        ariaLabel="测试选择"
        {...props}
        {...next}
      />,
    )
  }
  flushSync(() => render())
  const trigger = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.dsh-atb-sel')!
  const listbox = (): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>('.dsh-atb-sel-pop[role="listbox"]')].at(-1)
  const optionRows = (): HTMLElement[] => [...(listbox()?.querySelectorAll<HTMLElement>('.dsh-atb-sel-opt') ?? [])]
  const open = (): void => { if (trigger().getAttribute('aria-expanded') !== 'true') flushSync(() => trigger().click()) }
  const key = (k: string): void => {
    flushSync(() => {
      trigger().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    })
  }
  return { host, onChange, render, trigger, listbox, optionRows, open, key }
}

const OPTIONS: SelectOption[] = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta', icon: '★' },
  { value: 'gamma', label: 'Gamma', disabled: true },
  { value: 'delta', label: 'Delta' },
]

describe('Select — rendering and ARIA semantics', () => {
  it('renders a closed combobox showing the committed label', () => {
    const ui = mount(OPTIONS, { value: 'beta' })
    const trigger = ui.trigger()
    expect(trigger.getAttribute('role')).toBe('combobox')
    expect(trigger.getAttribute('aria-label')).toBe('测试选择')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger.getAttribute('aria-controls')).toBeNull()
    expect(trigger.getAttribute('aria-activedescendant')).toBeNull()
    expect(trigger.textContent).toContain('Beta')
    expect(trigger.textContent).toContain('★')
    expect(ui.listbox()).toBeUndefined()
  })

  it('shows the placeholder when no option matches the value', () => {
    const ui = mount(OPTIONS, { value: 'nope', placeholder: '请选择…' })
    expect(ui.trigger().textContent).toContain('请选择…')
  })

  it('opens a portalled listbox with options, aria-controls and an active descendant', () => {
    const ui = mount(OPTIONS, { value: 'beta' })
    ui.open()
    const trigger = ui.trigger()
    const listbox = ui.listbox()!
    expect(listbox.parentElement).toBe(document.body)
    expect(listbox.getAttribute('role')).toBe('listbox')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-controls')).toBe(listbox.id)
    const rows = ui.optionRows()
    expect(rows.map(row => row.querySelector('.dsh-atb-sel-label')!.textContent)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta'])
    expect(rows.every(row => row.getAttribute('role') === 'option')).toBe(true)
    // aria-selected reflects the COMMITTED value only.
    expect(rows.map(row => row.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false'])
    expect(rows[2]!.getAttribute('data-disabled')).toBe('true')
    // The active descendant points at the committed option's DOM id.
    expect(trigger.getAttribute('aria-activedescendant')).toBe(rows[1]!.id)
    expect(rows[1]!.getAttribute('data-active')).toBe('true')
  })

  it('applies id, className, full width and title overrides', () => {
    const ui = mount(OPTIONS, { value: 'alpha', id: 'pick', className: 'extra', full: true, title: 'Custom title' })
    const trigger = ui.trigger()
    expect(trigger.id).toBe('pick')
    expect(trigger.classList.contains('dsh-atb-sel')).toBe(true)
    expect(trigger.classList.contains('dsh-atb-sel-full')).toBe(true)
    expect(trigger.classList.contains('extra')).toBe(true)
    expect(trigger.getAttribute('title')).toBe('Custom title')
  })

  it('a disabled control cannot be opened', () => {
    const ui = mount(OPTIONS, { disabled: true })
    expect(ui.trigger().disabled).toBe(true)
    expect(ui.trigger().getAttribute('aria-disabled')).toBe('true')
    flushSync(() => ui.trigger().click())
    expect(ui.listbox()).toBeUndefined()
  })
})

describe('Select — keyboard navigation', () => {
  it('ArrowDown/ArrowUp move the active row, skip disabled rows and wrap', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    ui.open()
    const activeLabel = (): string | undefined =>
      ui.optionRows().find(row => row.getAttribute('data-active') === 'true')?.querySelector('.dsh-atb-sel-label')?.textContent ?? undefined
    expect(activeLabel()).toBe('Alpha')
    ui.key('ArrowDown')
    expect(activeLabel()).toBe('Beta')
    // Gamma is disabled: the next step must skip it.
    ui.key('ArrowDown')
    expect(activeLabel()).toBe('Delta')
    // Wraps back to the first enabled row.
    ui.key('ArrowDown')
    expect(activeLabel()).toBe('Alpha')
    ui.key('ArrowUp')
    expect(activeLabel()).toBe('Delta')
    // aria-activedescendant follows the active row.
    const activeRow = ui.optionRows().find(row => row.getAttribute('data-active') === 'true')!
    expect(ui.trigger().getAttribute('aria-activedescendant')).toBe(activeRow.id)
  })

  it('Home and End jump to the first and last option', () => {
    const ui = mount(OPTIONS.filter(option => !option.disabled), { value: 'beta' })
    ui.open()
    const activeIndex = (): number => ui.optionRows().findIndex(row => row.getAttribute('data-active') === 'true')
    expect(activeIndex()).toBe(1)
    ui.key('End')
    expect(activeIndex()).toBe(2)
    ui.key('Home')
    expect(activeIndex()).toBe(0)
  })

  it('Enter commits the active option, closes and returns focus to the trigger', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    ui.open()
    ui.key('ArrowDown') // Beta
    ui.key('Enter')
    expect(ui.onChange).toHaveBeenCalledWith('beta')
    expect(ui.listbox()).toBeUndefined()
    expect(document.activeElement).toBe(ui.trigger())
  })

  it('Space commits the active option too', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    ui.open()
    ui.key('ArrowDown')
    ui.key(' ')
    expect(ui.onChange).toHaveBeenCalledWith('beta')
    expect(ui.listbox()).toBeUndefined()
  })

  it('Escape closes without committing and keeps focus on the trigger', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    ui.open()
    ui.key('Escape')
    expect(ui.onChange).not.toHaveBeenCalled()
    expect(ui.listbox()).toBeUndefined()
    expect(document.activeElement).toBe(ui.trigger())
  })

  it('Tab closes without committing', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    ui.open()
    ui.key('Tab')
    expect(ui.onChange).not.toHaveBeenCalled()
    expect(ui.listbox()).toBeUndefined()
  })

  it('opens with ArrowDown/Enter/Space from the closed state', () => {
    for (const openKey of ['ArrowDown', 'Enter', ' ']) {
      const ui = mount(OPTIONS, { value: 'alpha' })
      ui.key(openKey)
      expect(ui.listbox(), `opened by ${openKey}`).toBeDefined()
      cleanup.splice(0).reverse().forEach(fn => fn())
      cleanup.length = 0
    }
  })

  it('ignores modifier keys and multi-character keys in typeahead', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    ui.open()
    const activeLabel = (): string | undefined =>
      ui.optionRows().find(row => row.getAttribute('data-active') === 'true')?.querySelector('.dsh-atb-sel-label')?.textContent ?? undefined
    // ArrowLeft is not a navigation/commit key here; active row must not move.
    ui.key('ArrowLeft')
    expect(activeLabel()).toBe('Alpha')
    // Ctrl+b must not run typeahead.
    flushSync(() => {
      ui.trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    expect(activeLabel()).toBe('Alpha')
  })
})

describe('Select — typeahead', () => {
  it('typing jumps to the first matching option by prefix', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    ui.open()
    const activeLabel = (): string | undefined =>
      ui.optionRows().find(row => row.getAttribute('data-active') === 'true')?.querySelector('.dsh-atb-sel-label')?.textContent ?? undefined
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000)
    ui.key('d')
    expect(activeLabel()).toBe('Delta')
    // A new single-character search after the typeahead window resets the buffer.
    now.mockReturnValue(2_000)
    ui.key('b')
    expect(activeLabel()).toBe('Beta')
  })

  it('accumulates characters inside the typeahead window and resets after it', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    ui.open()
    const activeLabel = (): string | undefined =>
      ui.optionRows().find(row => row.getAttribute('data-active') === 'true')?.querySelector('.dsh-atb-sel-label')?.textContent ?? undefined
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000)
    ui.key('d') // "d" → Delta
    expect(activeLabel()).toBe('Delta')
    now.mockReturnValue(1_200)
    ui.key('e') // "de" → Delta still matches the prefix
    expect(activeLabel()).toBe('Delta')
    // More than 700ms later the buffer restarts with the single key.
    now.mockReturnValue(2_500)
    ui.key('a') // "a" → Alpha
    expect(activeLabel()).toBe('Alpha')
  })

  it('a disabled row is never chosen by typeahead', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    ui.open()
    ui.key('g') // Gamma is disabled → no active row changes
    const activeLabel = ui.optionRows().find(row => row.getAttribute('data-active') === 'true')
      ?.querySelector('.dsh-atb-sel-label')?.textContent
    expect(activeLabel).toBe('Alpha')
  })
})

describe('Select — pointer interaction and portal placement', () => {
  it('clicking an option commits it and closes the popup', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    ui.open()
    const delta = ui.optionRows().find(row => row.textContent?.includes('Delta'))!
    // Pointer-down on a row is cancelled so the trigger never loses focus
    // before the click commits (standard combobox focus preservation).
    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
    flushSync(() => delta.dispatchEvent(pointerDown))
    expect(pointerDown.defaultPrevented).toBe(true)
    flushSync(() => delta.click())
    expect(ui.onChange).toHaveBeenCalledWith('delta')
    expect(ui.listbox()).toBeUndefined()
  })

  it('clicking a disabled option commits nothing and keeps the popup open', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    ui.open()
    const gamma = ui.optionRows().find(row => row.textContent?.includes('Gamma'))!
    flushSync(() => gamma.click())
    expect(ui.onChange).not.toHaveBeenCalled()
    expect(ui.listbox()).toBeDefined()
  })

  it('an outside pointerdown closes the popup; a pointerdown inside it does not', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    ui.open()
    const listbox = ui.listbox()!
    flushSync(() => listbox.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(ui.listbox()).toBeDefined()
    const outside = document.createElement('div')
    document.body.append(outside)
    flushSync(() => outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(ui.listbox()).toBeUndefined()
  })

  it('positions the fixed popup under the trigger and clamps it inside the viewport', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    vi.spyOn(ui.trigger(), 'getBoundingClientRect').mockReturnValue({
      left: 900, right: 1_100, top: 100, bottom: 130, width: 200, height: 30, x: 900, y: 100, toJSON: () => ({}),
    } as DOMRect)
    ui.open()
    const listbox = ui.listbox()!
    const left = Number.parseFloat(listbox.style.left)
    const top = Number.parseFloat(listbox.style.top)
    // 900 + 200 would overflow a 1024px viewport: the popup is clamped.
    expect(Number.isFinite(left)).toBe(true)
    expect(Number.isFinite(top)).toBe(true)
    expect(left).toBeLessThanOrEqual(window.innerWidth - Number.parseFloat(listbox.style.width) - 8 + 0.01)
    expect(top).toBeGreaterThanOrEqual(8)
  })

  it('repositions on window resize while open', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    const rect = vi.spyOn(ui.trigger(), 'getBoundingClientRect')
    rect.mockReturnValue({ left: 10, right: 210, top: 100, bottom: 130, width: 200, height: 30, x: 10, y: 100, toJSON: () => ({}) } as DOMRect)
    ui.open()
    const before = ui.listbox()!.style.top
    rect.mockReturnValue({ left: 10, right: 210, top: 300, bottom: 330, width: 200, height: 30, x: 10, y: 300, toJSON: () => ({}) } as DOMRect)
    flushSync(() => window.dispatchEvent(new Event('resize')))
    expect(ui.listbox()!.style.top).not.toBe(before)
  })

  it('repositions on window scroll while open', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    const rect = vi.spyOn(ui.trigger(), 'getBoundingClientRect')
    rect.mockReturnValue({ left: 10, right: 210, top: 100, bottom: 130, width: 200, height: 30, x: 10, y: 100, toJSON: () => ({}) } as DOMRect)
    ui.open()
    const before = ui.listbox()!.style.top
    rect.mockReturnValue({ left: 10, right: 210, top: 400, bottom: 430, width: 200, height: 30, x: 10, y: 400, toJSON: () => ({}) } as DOMRect)
    flushSync(() => window.dispatchEvent(new Event('scroll')))
    expect(ui.listbox()!.style.top).not.toBe(before)
  })

  it('cannot open a control with no options', () => {
    const ui = mount([], { value: '' })
    flushSync(() => ui.trigger().click())
    expect(ui.listbox()).toBeUndefined()
  })

  it('keeps the active row when every option is disabled', () => {
    const allDisabled: SelectOption[] = [
      { value: 'x', label: 'X', disabled: true },
      { value: 'y', label: 'Y', disabled: true },
    ]
    const ui = mount(allDisabled, { value: 'x' })
    ui.open()
    ui.key('ArrowDown')
    const active = ui.optionRows().filter(row => row.getAttribute('data-active') === 'true')
    expect(active).toHaveLength(1)
    expect(active[0]!.textContent).toContain('X')
    ui.key('Enter')
    expect(ui.onChange).not.toHaveBeenCalled()
  })

  it('scrolls the active row into view when the browser supports it', () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView })
    try {
      const ui = mount(OPTIONS, { value: 'alpha' })
      ui.open()
      ui.key('ArrowDown')
      expect(scrollIntoView).toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })
})

describe('Select — known issue (documented, not fixed by QA)', () => {
  /**
   * REGRESSION (fixed in the fork review): the
   * Escape listener runs on `window` in the capture phase and calls
   * `preventDefault()` but never `stopPropagation()`. The event therefore
   * still reaches document-level bubble listeners, so pressing Escape in an
   * open Select inside TaskFormModal (which closes on a document keydown,
   * src/client/board/TaskFormModal.tsx:289-296) also closes the whole create/
   * edit form — losing unsaved input.
   *
   * `it.fails` keeps this documented without breaking the suite; when the
   * component starts stopping propagation this test will fail and should be
   * flipped to a normal expectation.
   */
  it('Escape that closes an open Select does not reach document-level Escape handlers', () => {
    const ui = mount(OPTIONS, { value: 'alpha' })
    const onDocumentEscape = vi.fn()
    const listener = (event: KeyboardEvent): void => { if (event.key === 'Escape') onDocumentEscape() }
    document.addEventListener('keydown', listener)
    cleanup.push(() => document.removeEventListener('keydown', listener))
    ui.open()
    ui.key('Escape')
    expect(ui.listbox()).toBeUndefined()
    expect(onDocumentEscape).not.toHaveBeenCalled()
  })

  /**
   * REGRESSION (fixed in the fork review): Home and
   * End set the active index to the first/last option unconditionally, so a
   * disabled edge row becomes the aria-activedescendant target and Enter does
   * nothing — WAI-ARIA combobox behaviour is to skip disabled options.
   * `openList` already skips disabled rows when nothing is selected; Home/End
   * (and a committed value pointing at a now-disabled row) do not.
   */
  it('Home skips a disabled first option', () => {
    const options: SelectOption[] = [
      { value: 'disabled-first', label: 'DisabledFirst', disabled: true },
      { value: 'b', label: 'Beta' },
      { value: 'c', label: 'Gamma' },
    ]
    const ui = mount(options, { value: 'b' })
    ui.open()
    ui.key('Home')
    const active = ui.optionRows().find(row => row.getAttribute('data-active') === 'true')
    expect(active?.textContent).toContain('Beta')
  })
})
