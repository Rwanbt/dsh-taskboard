// @vitest-environment jsdom
/**
 * Focused tests for the monochrome {@link Icon} set: every declared name must
 * render a decorative 16×16 stroked SVG, and the accessibility contract
 * (`aria-hidden`, `focusable="false"`) must never regress.
 *
 * The name list is read from the component source so a newly added icon cannot
 * silently escape this test (no duplicated hand-maintained list).
 *
 * @module dsh-taskboard/tests/icon
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { Icon, type IconName } from '../src/client/board/Icon.tsx'

const cleanup: Array<() => void> = []
afterEach(() => {
  cleanup.splice(0).reverse().forEach(fn => fn())
  document.body.innerHTML = ''
})

/** Every icon name declared by `export type IconName = ...`. */
function declaredIconNames(): string[] {
  const source = readFileSync(join(process.cwd(), 'src/client/board/Icon.tsx'), 'utf8')
  const union = /export type IconName =([\s\S]*?)\n\n/.exec(source)?.[1] ?? ''
  return [...union.matchAll(/'([A-Za-z]+)'/g)].map(match => match[1]!)
}

function renderIcon(name: string, size?: number): SVGSVGElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup.push(() => { root.unmount(); host.remove() })
  flushSync(() => {
    root.render(<Icon name={name as IconName} {...(size !== undefined ? { size } : {})} />)
  })
  const svg = host.querySelector('svg')
  if (svg === null) throw new Error(`Icon "${name}" rendered no <svg>`)
  return svg
}

describe('Icon — every declared name renders a decorative stroked SVG', () => {
  const names = declaredIconNames()

  it('discovers the full icon vocabulary from the component source', () => {
    expect(names.length).toBeGreaterThanOrEqual(25)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('settings')
    expect(names).toContain('check')
    expect(names).toContain('subtask')
  })

  it.each(declaredIconNames())('renders "%s" with the fixed a11y and stroke contract', name => {
    const svg = renderIcon(name)
    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(svg.getAttribute('width')).toBe('14')
    expect(svg.getAttribute('height')).toBe('14')
    expect(svg.getAttribute('fill')).toBe('none')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('stroke-width')).toBe('1.5')
    expect(svg.getAttribute('stroke-linecap')).toBe('round')
    expect(svg.getAttribute('stroke-linejoin')).toBe('round')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('focusable')).toBe('false')
    expect(svg.classList.contains('dsh-atb-icon')).toBe(true)
    // Every icon draws at least one shape.
    expect(svg.children.length).toBeGreaterThan(0)
    const shapeTags = [...svg.children].map(child => child.tagName.toLowerCase())
    for (const tag of shapeTags) expect(['path', 'circle', 'rect']).toContain(tag)
  })

  it('honours an explicit pixel size', () => {
    const svg = renderIcon('check', 22)
    expect(svg.getAttribute('width')).toBe('22')
    expect(svg.getAttribute('height')).toBe('22')
  })

  it('renders an empty decorative SVG (no crash) for an unknown runtime name', () => {
    const svg = renderIcon('not-a-real-icon')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.children.length).toBe(0)
  })
})
