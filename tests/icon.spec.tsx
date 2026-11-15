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
    // Every icon draws at least one shape. A single `<g>` is allowed as a
    // container (a glyph drawn on another grid, scaled into the 16-unit box),
    // but only for real shape children: no text, image, style or foreignObject.
    expect(svg.children.length).toBeGreaterThan(0)
    const shapesOf = (root: Element): Element[] => {
      const out: Element[] = []
      for (const child of [...root.children]) {
        if (child.tagName.toLowerCase() === 'g') out.push(...shapesOf(child))
        else out.push(child)
      }
      return out
    }
    const shapeTags = shapesOf(svg).map(child => child.tagName.toLowerCase())
    expect(shapeTags.length).toBeGreaterThan(0)
    for (const tag of shapeTags) expect(['path', 'circle', 'rect']).toContain(tag)
  })

  it('draws the settings glyph as a cog, not as detached brightness rays', () => {
    // Regression: the first version of the icon was a ring with eight separate
    // rays, which reads as a sun/brightness toggle. The settings action opens
    // the appearance panel, so it must be a recognisable cog.
    const svg = renderIcon('settings')
    const shapes = [...svg.querySelectorAll('path, circle')]
    expect(shapes.length).toBe(2)
    const outline = shapes.find(shape => shape.tagName.toLowerCase() === 'path')
    const hub = shapes.find(shape => shape.tagName.toLowerCase() === 'circle')
    expect(outline).toBeDefined()
    expect(hub).toBeDefined()
    // One closed outline (Z) + one round hub: the classic cog silhouette.
    expect(outline?.getAttribute('d')?.endsWith('z')).toBe(true)
    expect(hub?.getAttribute('r')).toBe('3')
    // The old sun glyph had a ring plus eight radial strokes; those are gone.
    const markup = svg.outerHTML
    for (const ray of ['M8 2.2v1.4', 'M8 12.4v1.4', 'M2.2 8h1.4', 'M12.4 8h1.4']) {
      expect(markup).not.toContain(ray)
    }
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
