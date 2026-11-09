/**
 * Helpers for driving the themed {@link Select} control from jsdom tests.
 *
 * The native `<select>` is gone: every select is now a
 * `button.dsh-atb-sel[role="combobox"]` whose listbox is portalled to
 * `document.body` (`.dsh-atb-sel-pop[role="listbox"]`) and exists only while
 * open. Tests therefore drive the control the way a user does — open the
 * trigger, click the option by its visible label — and assert state through
 * the trigger's visible text or the option's `data-selected` attribute.
 *
 * @module dsh-taskboard/tests/select-helpers
 */

import { flushSync } from 'react-dom'

/** The trigger of a themed Select (a real `<button>`, never a native select). */
export type SelectTrigger = HTMLButtonElement

/**
 * Find the trigger of a labelled field inside `scope`: first by exact
 * `aria-label`, then by the field row whose `.dsh-atb-field-label` matches.
 * @param scope - component root (host div or a panel/section).
 * @param label - localized field label, e.g. `'项目'`.
 * @throws when no themed Select matches.
 */
export function selectByLabel(scope: ParentNode, label: string): SelectTrigger {
  const byAria = [...scope.querySelectorAll<SelectTrigger>('.dsh-atb-sel[aria-label]')]
    .find(trigger => trigger.getAttribute('aria-label') === label)
  if (byAria !== undefined) return byAria
  const row = [...scope.querySelectorAll('label')]
    .find(element => element.querySelector('.dsh-atb-field-label')?.textContent?.replace(/\*$/, '') === label)
  const inside = row?.querySelector<SelectTrigger>('.dsh-atb-sel')
  if (inside !== undefined && inside !== null) return inside
  throw new Error(`selectByLabel: no themed Select for label "${label}"`)
}

/** Find a trigger by its position among every themed Select in `scope`. */
export function selectByIndex(scope: ParentNode, index: number): SelectTrigger {
  const trigger = scope.querySelectorAll<SelectTrigger>('.dsh-atb-sel')[index]
  if (trigger === undefined) throw new Error(`selectByIndex: no themed Select at index ${index}`)
  return trigger
}

/** Visible text of a themed Select trigger (selected label, else placeholder). */
export function selectText(trigger: Element): string {
  return trigger.querySelector('.dsh-atb-sel-value')?.textContent?.trim() ?? ''
}

/** The portalled listbox of the currently open select, if any. */
function currentListbox(): HTMLElement | undefined {
  const all = document.querySelectorAll<HTMLElement>('.dsh-atb-sel-pop[role="listbox"]')
  return all[all.length - 1]
}

/**
 * Open a trigger and return its portalled listbox.
 *
 * React 18 applies state updates from a raw `element.click()` on the next
 * tick outside `act`, so the click is wrapped in `flushSync` — this keeps the
 * helper synchronous (the popup exists before it returns), which is what the
 * native-select tests assumed.
 * @throws when the control is disabled or the popup did not open.
 */
export function openSelect(trigger: SelectTrigger): HTMLElement {
  if (trigger.getAttribute('aria-expanded') !== 'true') flushSync(() => trigger.click())
  const listbox = currentListbox()
  if (listbox === undefined) throw new Error('openSelect: the select popup did not open')
  return listbox
}

/** Close the open select (Escape keeps focus on the trigger). */
export function closeSelect(trigger: SelectTrigger): void {
  if (trigger.getAttribute('aria-expanded') === 'true') {
    flushSync(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  }
}

/** Visible labels of every option, in DOM order (opens and closes the popup). */
export function selectOptionLabels(trigger: SelectTrigger): string[] {
  const listbox = openSelect(trigger)
  const labels = [...listbox.querySelectorAll<HTMLElement>('.dsh-atb-sel-opt')]
    .map(option => option.querySelector('.dsh-atb-sel-label')?.textContent?.trim() ?? '')
  closeSelect(trigger)
  return labels
}

/** Whether the option matching `label` is the currently selected one. */
export function isSelectedOption(trigger: SelectTrigger, label: string): boolean {
  const listbox = openSelect(trigger)
  const selected = [...listbox.querySelectorAll<HTMLElement>('.dsh-atb-sel-opt')]
    .find(option => option.getAttribute('data-selected') === 'true')
  const text = selected?.querySelector('.dsh-atb-sel-label')?.textContent ?? ''
  closeSelect(trigger)
  return text.includes(label)
}

/**
 * Open a themed Select trigger and click the option whose label contains
 * `label`. This mirrors `select.value = value; dispatchEvent(change)`.
 * @param trigger - the trigger button.
 * @param label - visible option label (or a unique fragment of it).
 * @throws when the option does not exist.
 */
export function chooseSelect(trigger: Element, label: string): void {
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new Error('chooseSelect: trigger is not a themed Select button')
  }
  const listbox = openSelect(trigger)
  const options = [...listbox.querySelectorAll<HTMLElement>('.dsh-atb-sel-opt')]
  const textOf = (element: HTMLElement): string =>
    (element.querySelector('.dsh-atb-sel-label')?.textContent ?? element.textContent ?? '').trim()
  // Exact label first, then a prefix match, then a substring match: option
  // labels may carry suffixes like `（部署默认）` or `（当前：Medium）`, and a
  // naive substring would pick the "follow default (current: Medium)" row
  // when the caller asked for the explicit `Medium` option.
  const option = options.find(element => textOf(element) === label)
    ?? options.find(element => textOf(element).startsWith(label))
    ?? options.find(element => textOf(element).includes(label))
  if (option === undefined) {
    const available = options.map(textOf)
    closeSelect(trigger)
    throw new Error(`chooseSelect: no option containing "${label}" (available: ${available.join(' | ')})`)
  }
  flushSync(() => option.click())
}