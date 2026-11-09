// @vitest-environment jsdom
/**
 * Structural invariants for the injected stylesheet (`STYLES`): the DSH
 * design-token bridge must stay the single source of colour, the flat-pass
 * card must not reintroduce a visible 1px outline in the final cascade, the
 * portalled Select popup must keep the DSH floating-surface recipe, and
 * `injectStyles()` must keep its ownership tags (the 0.4.4 lost-CSS fix).
 *
 * These assert cascade-relevant declarations by parsing the stylesheet text —
 * no whole-DOM snapshots and no dependence on jsdom's incomplete `var()`
 * resolution.
 *
 * @module dsh-taskboard/tests/styles-invariants
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STYLES, injectStyles } from '../src/client/styles.ts'

interface CssRule {
  selectors: string[]
  body: string
  media?: string
}

/** Parse top-level rules (and rules nested in @media/@supports). */
function parseRules(css: string, media?: string): CssRule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  let index = 0
  while (index < source.length) {
    const open = source.indexOf('{', index)
    if (open < 0) break
    const prelude = source.slice(index, open).trim()
    let depth = 1
    let cursor = open + 1
    for (; cursor < source.length && depth > 0; cursor++) {
      if (source[cursor] === '{') depth++
      else if (source[cursor] === '}') depth--
    }
    const body = source.slice(open + 1, cursor - 1)
    if (prelude.startsWith('@')) {
      if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
        rules.push(...parseRules(body, prelude))
      }
    } else if (prelude.length > 0) {
      rules.push({
        selectors: prelude.split(',').map(selector => selector.trim()).filter(Boolean),
        body,
        ...(media !== undefined ? { media } : {}),
      })
    }
    index = cursor
  }
  return rules
}

/** Declarations of a rule body, last declaration wins per property. */
function declarations(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const raw of body.split(';')) {
    const colon = raw.indexOf(':')
    if (colon < 0) continue
    const property = raw.slice(0, colon).trim().toLowerCase()
    const value = raw.slice(colon + 1).trim()
    if (property.length > 0) map.set(property, value)
  }
  return map
}

const rules = parseRules(STYLES)
const topLevel = rules.filter(rule => rule.media === undefined)

/** Rules whose selector list contains exactly `selector`. */
function rulesFor(selector: string): CssRule[] {
  return topLevel.filter(rule => rule.selectors.includes(selector))
}

describe('styles.ts — DSH design-token bridge', () => {
  it('maps the board palette onto the shell tokens on <body>', () => {
    const body = rulesFor('body').find(rule => rule.body.includes('--atb-text'))
    expect(body, 'no body token-bridge rule').toBeDefined()
    const css = body!.body
    expect(css).toMatch(/--atb-text:\s*var\(--dsw-alias-label-primary/)
    expect(css).toMatch(/--atb-text-2:\s*var\(--dsw-alias-label-secondary/)
    expect(css).toMatch(/--atb-bg:\s*var\(--dsw-alias-bg-base/)
    expect(css).toMatch(/--atb-menu:\s*var\(--dsw-menu-surface-fill/)
    expect(css).toMatch(/--atb-menu-blur:\s*var\(--dsw-menu-backdrop-filter/)
    expect(css).toMatch(/--atb-accent:\s*var\(--dsw-alias-state-business-primary/)
    expect(css).toMatch(/--atb-error:\s*var\(--dsw-alias-state-error-primary/)
  })

  it('never hardcodes the flat-pass surfaces: card and popup use bridged variables', () => {
    const cardRules = rulesFor('.dsh-atb-card')
    const last = cardRules.at(-1)!
    expect(last.body).toMatch(/box-shadow:\s*[^;]*var\(--atb-|box-shadow:\s*0 0 0/)
    const popup = rulesFor('.dsh-atb-sel-pop')
    expect(popup.length).toBeGreaterThan(0)
    expect(popup.at(-1)!.body).toMatch(/background:\s*var\(--atb-menu/)
  })
})

describe('styles.ts — flat-pass card has no visible 1px outline', () => {
  it('the final .dsh-atb-card rule sets border-color transparent and adds no border shorthand', () => {
    const cardRules = rulesFor('.dsh-atb-card')
    expect(cardRules.length).toBeGreaterThan(1)
    const last = cardRules.at(-1)!
    const decl = declarations(last.body)
    expect(decl.get('border-color')).toBe('transparent')
    // The flat pass must not (re)introduce a shorthand outline.
    expect(decl.has('border')).toBe(false)
    expect(decl.has('border-width')).toBe(false)
    expect(decl.has('border-style')).toBe(false)
  })

  it('simulating the cascade leaves the card border transparent (invisible), not 1px solid', () => {
    // Same-specificity rules apply in source order; later declarations win.
    let borderColor: string | undefined
    let borderShorthand: string | undefined
    for (const rule of rulesFor('.dsh-atb-card')) {
      const decl = declarations(rule.body)
      if (decl.has('border')) borderShorthand = decl.get('border')
      if (decl.has('border-color')) borderColor = decl.get('border-color')
    }
    // The base rule still carries the 1px solid shorthand…
    expect(borderShorthand).toBeDefined()
    expect(borderShorthand!).toMatch(/1px\s+solid/)
    // …but the final cascade overrides the visible colour to transparent, so
    // no 1px solid outline is painted.
    expect(borderColor).toBe('transparent')
    const visible = borderColor !== undefined && !/transparent/.test(borderColor)
    expect(visible).toBe(false)
  })
})

describe('styles.ts — Select popup keeps the DSH floating-surface recipe', () => {
  it('is fixed-position, themed, elevated and above board content', () => {
    const popup = rulesFor('.dsh-atb-sel-pop').at(-1)!
    const decl = declarations(popup.body)
    expect(decl.get('position')).toBe('fixed')
    expect(decl.get('background')).toMatch(/var\(--atb-menu/)
    expect(decl.get('backdrop-filter') ?? decl.get('-webkit-backdrop-filter')).toMatch(/var\(--atb-menu-blur/)
    expect(decl.get('border-radius')).toMatch(/var\(--atb-radius-/)
    expect(decl.get('box-shadow')).toMatch(/var\(--atb-elevation-/)
    expect(Number.parseInt(decl.get('z-index') ?? '0', 10)).toBeGreaterThanOrEqual(1000)
  })

  it('styles the trigger, disabled rows and the active row', () => {
    const triggerRule = topLevel.find(rule => rule.selectors.includes('.dsh-atb-sel') && /cursor:\s*pointer/.test(rule.body))
    expect(triggerRule, 'no pointer cursor on the Select trigger').toBeDefined()
    const disabledRow = rulesFor('.dsh-atb-sel-opt[data-disabled="true"]').at(-1)!
    expect(declarations(disabledRow.body).get('cursor')).toBe('default')
    const activeRow = rulesFor('.dsh-atb-sel-opt[data-active="true"]').at(-1)!
    expect(declarations(activeRow.body).get('background')).toMatch(/var\(--atb-/)
  })

  it('styles the icon hook as a non-shrinking inline glyph', () => {
    const icon = declarations(rulesFor('.dsh-atb-icon').at(-1)!.body)
    expect(icon.get('display')).toBe('inline-block')
    expect(icon.get('flex')).toBe('none')
  })
})

describe('styles.ts — injectStyles ownership contract', () => {
  afterEach(() => {
    // Restore the global BEFORE touching the DOM: the no-DOM test stubs it out.
    vi.unstubAllGlobals()
    document.getElementById('dsh-taskboard-styles')?.remove()
  })

  it('injects one tagged stylesheet into <head> and is idempotent', () => {
    injectStyles()
    const first = document.getElementById('dsh-taskboard-styles') as HTMLStyleElement | null
    expect(first).not.toBeNull()
    expect(first!.tagName.toLowerCase()).toBe('style')
    expect(first!.textContent).toBe(STYLES)
    expect(first!.dataset.plugin).toBe('dsh-taskboard')
    expect(first!.dataset.pluginCss).toBe('dsh-taskboard/styles')
    expect(document.querySelectorAll('#dsh-taskboard-styles')).toHaveLength(1)
    injectStyles()
    expect(document.getElementById('dsh-taskboard-styles')).toBe(first)
    expect(document.querySelectorAll('#dsh-taskboard-styles')).toHaveLength(1)
  })

  it('re-attaches after the shell removed the element (0.4.4 lost-CSS fix)', () => {
    injectStyles()
    document.getElementById('dsh-taskboard-styles')!.remove()
    injectStyles()
    expect(document.querySelectorAll('#dsh-taskboard-styles')).toHaveLength(1)
    expect(document.getElementById('dsh-taskboard-styles')!.textContent).toBe(STYLES)
  })

  it('adopts and re-tags a leftover untagged element', () => {
    const leftover = document.createElement('style')
    leftover.id = 'dsh-taskboard-styles'
    leftover.textContent = STYLES
    document.head.append(leftover)
    injectStyles()
    const tagged = document.getElementById('dsh-taskboard-styles') as HTMLStyleElement
    expect(tagged).toBe(leftover)
    expect(tagged.dataset.plugin).toBe('dsh-taskboard')
    expect(tagged.dataset.pluginCss).toBe('dsh-taskboard/styles')
  })

  it('is a no-op without a DOM (server-side import safety)', () => {
    vi.stubGlobal('document', undefined)
    try {
      expect(() => injectStyles()).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
