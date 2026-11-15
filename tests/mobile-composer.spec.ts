// @vitest-environment jsdom
/**
 * Mobile comment composer contract.
 *
 * Real report: at the bottom of the mobile drawer the writing area was a sliver
 * on the left — the row is `textarea (flex: 1) + image + Post + Send & let the
 * agent handle`, so on a 360–390 px sheet the two labelled buttons left the
 * textarea a few pixels wide and the 12.5 px font made iOS zoom the whole page
 * on focus.
 *
 * jsdom has no layout, so this file pins the stylesheet determinants; the real
 * geometry is measured by `scripts/qa/detail-audit.mjs` on a real host
 * (textarea 356×108 at 390 px, 326×108 at 360 px, font 16 px, buttons on their
 * own row, composer flush inside the panel).
 *
 * @module dsh-taskboard/tests/mobile-composer
 */
import { describe, expect, it } from 'vitest'
import { STYLES } from '../src/client/styles.ts'

/** The portrait focus-mode block (the phone sheet rules). */
function portraitBlock(): string {
  const start = STYLES.indexOf('@media (max-width: 760px) {')
  expect(start).toBeGreaterThanOrEqual(0)
  const nextMedia = STYLES.indexOf('@media (orientation: landscape)', start)
  return STYLES.slice(start, nextMedia === -1 ? undefined : nextMedia)
}

describe('mobile comment composer', () => {
  it('gives the writing area its own full-width line', () => {
    const block = portraitBlock()
    expect(block).toContain('.dsh-atb-composer { flex-wrap: wrap; gap: 8px; align-items: stretch; }')
    expect(block).toContain('.dsh-atb-composer-input { flex: 1 1 100%; min-height: 88px;')
  })

  it('never lets the send buttons squeeze the field', () => {
    const block = portraitBlock()
    // The buttons do not grow; only the deliver button may fill a wrapped line.
    expect(block).toContain('.dsh-atb-composer-send { flex: 0 1 auto; min-width: 0;')
    expect(block).toContain('.dsh-atb-composer-deliver { flex: 1 1 auto; white-space: normal; text-align: center; }')
  })

  it('uses a 16px field so iOS does not zoom the page on focus', () => {
    const block = portraitBlock()
    expect(block).toContain('font-size: 16px; line-height: 1.45;')
    // Landscape keeps the single row but must keep the same font size.
    const landscape = STYLES.slice(STYLES.indexOf('@media (orientation: landscape) and (max-height: 680px)'))
    expect(landscape).toContain('.dsh-atb-composer-input { font-size: 16px; }')
  })

  it('keeps the desktop composer untouched (outside the phone blocks)', () => {
    // The base rule still lays the field and the buttons on one row.
    expect(STYLES).toContain('.dsh-atb-composer { display: flex; gap: 7px; align-items: flex-end; margin-top: 2px; }')
  })
})
