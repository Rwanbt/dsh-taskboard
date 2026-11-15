// @vitest-environment jsdom
/**
 * Acceptance-checklist row layout (regression).
 *
 * Real bug, found on a phone: a checklist item whose evidence meta carried a
 * long note (`white-space: nowrap`, `max-width: 280px`) was laid out with
 * `flex-shrink: 0`. On a 390 px drawer the meta claimed 280 px of a 326 px row,
 * the label was squeezed to **0 px** and printed one character per line — 48
 * lines of a single letter each.
 *
 * jsdom has no layout, so this file pins the *determinants* of the fix (a real
 * flex basis for the label, a shrinkable and capped meta column) and the real
 * geometry is proven against a real DSH host by
 * `scripts/qa/detail-audit.mjs` (text 139 px wide / 3 lines at 390 px, 710 px /
 * 1 line at 1440 px, desktop meta still capped at 280 px).
 *
 * @module dsh-taskboard/tests/checklist-layout
 */
import { describe, expect, it } from 'vitest'
import { STYLES } from '../src/client/styles.ts'

/** The declaration block of one selector, exactly as the stylesheet ships it. */
function ruleOf(selector: string): string {
  // Anchored on the newline: `.dsh-atb-cl-text` also appears as the tail of
  // `.dsh-atb-cl-item[data-checked="true"] .dsh-atb-cl-text`, which is not the
  // rule under test.
  const start = STYLES.indexOf(`\n${selector} {`)
  expect(start, `${selector} must be declared`).toBeGreaterThanOrEqual(0)
  const end = STYLES.indexOf('}', start)
  return STYLES.slice(start, end)
}

describe('acceptance checklist row layout', () => {
  const text = ruleOf('.dsh-atb-cl-text')
  const meta = ruleOf('.dsh-atb-cl-meta')

  it('keeps a real flex basis for the item label', () => {
    // `flex: 1` (basis 0) is what allowed the collapse: keep a readable basis.
    expect(text).toContain('flex: 1 1 140px')
    expect(text).toContain('min-width: 0')
    // Long words must still break inside the label rather than overflow.
    expect(text).toContain('word-break: break-word')
  })

  it('lets the evidence column shrink and caps it to a share of the row', () => {
    // The regression: `flex-shrink: 0` + a 280px nowrap note.
    expect(meta).not.toContain('flex-shrink: 0')
    expect(meta).toContain('flex: 0 1 auto')
    expect(meta).toContain('min-width: 0')
    expect(meta).toContain('max-width: 42%')
  })

  it('keeps the evidence note as a truncated preview, never as a wide block', () => {
    const note = ruleOf('.dsh-atb-cl-note')
    expect(note).toContain('max-width: 280px')
    expect(note).toContain('white-space: nowrap')
    expect(note).toContain('text-overflow: ellipsis')
  })

  it('never squeezes any checklist label with a fixed-height row', () => {
    const item = ruleOf('.dsh-atb-cl-item')
    expect(item).not.toContain('height:')
    expect(item).not.toContain('overflow: hidden')
  })
})
