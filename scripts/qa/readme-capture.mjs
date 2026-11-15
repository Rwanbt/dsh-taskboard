/**
 * The screenshots embedded in the READMEs, captured from the **current** build.
 *
 * The old `img/board.png` and `img/modal.png` were taken before the DeepSeek
 * Pastel UI existed, so the README advertised a plugin that no longer exists.
 * This script seeds the same **fictional** demo board as the hero shots
 * (`demo-board.mjs`) and captures, from the production client bundle of this
 * working tree:
 *   - the desktop board at 1760 px (panel only, no host chrome) → `img/board.png`,
 *   - the new-task dialog, filled with demo values → `img/modal.png`,
 *   - the phone portrait panel → `img/phone.png`.
 *
 * Shots are taken at 2× and the desktop/dialog masters are halved by the caller
 * (`System.Drawing`, HighQualityBicubic) so the PNGs are sharp on a retina
 * screen without shipping 3000 px files.
 *
 * Every shot goes through `shootElement`, which freezes the CSS animations
 * first: the capture re-renders the page and would otherwise restart the
 * dialog's `dsh-atb-pop` opening animation, framing a dialog still at
 * `scale(.98)` — the dimmed board then showed around it, which reads as two
 * images superimposed in transparency.
 *
 * Driven by `scripts/qa/pastel-visual-host.ps1 -CaptureScript readme-capture.mjs`,
 * or run directly against a kept host:
 *   PTB_BASE=… PTB_TOKEN=… PTB_OUT=… PTB_BROWSER=… node scripts/qa/readme-capture.mjs
 *
 * @module dsh-taskboard/scripts/qa/readme-capture
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { DEMO_APPEARANCE, clearOverlays, ensurePanel, seedBoard, sleep } from './demo-board.mjs'

const base = process.env.PTB_BASE
const token = process.env.PTB_TOKEN
const outDir = process.env.PTB_OUT
const executablePath = process.env.PTB_BROWSER
if (!base || !token || !outDir || !executablePath) {
  console.error('missing PTB_BASE / PTB_TOKEN / PTB_OUT / PTB_BROWSER')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

const theme = (process.env.PTB_THEME ?? 'dark') === 'light' ? 'light' : 'dark'

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  protocolTimeout: 180_000,
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb', '--lang=fr-FR', '--disable-extensions'],
  defaultViewport: { width: 2040, height: 1200, deviceScaleFactor: 2 },
})
const page = await browser.newPage()
page.on('pageerror', error => console.log('pageerror:', String(error)))
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
await page.goto(`${base}/?token=${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => document.querySelector('.dsh-atb-board .dsh-atb-card') !== null
  || document.querySelector('button .dsh-atb-pglyph') !== null
  || document.querySelector('[class*="_dialog_"]') !== null, { timeout: 60_000 })

await ensurePanel(page)
const seed = await seedBoard(page)
console.log('seed:', JSON.stringify(seed))
writeFileSync(join(outDir, 'readme-seed.json'), JSON.stringify(seed, null, 2))
if (seed.ok !== true) {
  console.error('demo board rejected by the import route — refusing to capture', JSON.stringify(seed))
  await browser.close()
  process.exit(1)
}

/* Same pastel appearance as the hero: category colours, grouped by project. */
await page.evaluate(appearance => {
  localStorage.setItem('dsh-taskboard-appearance-v2', JSON.stringify(appearance))
}, DEMO_APPEARANCE)
await page.reload({ waitUntil: 'domcontentloaded' })
await ensurePanel(page)
await page.waitForFunction(() => document.querySelectorAll('.dsh-atb-card').length > 5, { timeout: 60_000 })
await sleep(1500)

/** Clip rectangle of an element, plus a hit-test proving it is what is visible. */
async function clipOf(selector) {
  return page.evaluate(target => {
    const element = document.querySelector(target)
    if (element === null) return null
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(rect.x + rect.width / 2), Math.round(rect.y + Math.min(60, rect.height / 2)))
    return {
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.round(rect.width), height: Math.round(rect.height),
      reachable: hit !== null && (hit === element || element.contains(hit)),
    }
  }, selector)
}

/**
 * Freeze CSS animations and transitions before a shot.
 *
 * `Page.captureScreenshot` re-renders the page for the capture, which restarts
 * the running CSS animations **in that copy**. The new-task dialog opens with
 * `dsh-atb-pop` (`translateY(8px) scale(.98)` → none): the first version of this
 * script therefore captured the dialog at ~98 % of its measured box, so the
 * clip framed a smaller dialog and the dimmed board showed around it — the
 * "two images superimposed in transparency" report. Disabling the animations
 * makes the capture identical to the last frame a user would see.
 */
async function stabilize() {
  await page.evaluate(() => {
    if (document.getElementById('dsh-atb-shot-still') !== null) return
    const style = document.createElement('style')
    style.id = 'dsh-atb-shot-still'
    style.textContent = '*, *::before, *::after { animation-duration: 0s !important; '
      + 'animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }'
    document.head.appendChild(style)
  })
  await page.evaluate(async () => {
    for (const animation of document.getAnimations()) {
      try { animation.finish() } catch { /* infinite animation: nothing to finish */ }
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

/**
 * Shoot an element and prove the capture is aligned with it: the rect must be
 * the same before and after the screenshot, and the element must carry no
 * residual transform.
 */
async function shootElement(selector, file) {
  await stabilize()
  const before = await clipOf(selector)
  if (before === null) throw new Error(`cannot shoot ${selector}: element missing`)
  const residual = await page.evaluate(target => {
    const element = document.querySelector(target)
    if (element === null) return null
    const style = getComputedStyle(element)
    return { transform: style.transform, animation: style.animationName, opacity: style.opacity }
  }, selector)
  await page.screenshot({ path: join(outDir, file), clip: before })
  const after = await clipOf(selector)
  if (after === null || after.x !== before.x || after.y !== before.y
    || after.width !== before.width || after.height !== before.height) {
    throw new Error(`${file}: clip moved between measure and capture (${JSON.stringify({ before, after })})`)
  }
  if (residual !== null && residual.transform !== 'none') {
    throw new Error(`${file}: ${selector} still transformed (${residual.transform}) — the capture would be misaligned`)
  }
  return { ...before, residual }
}

const shots = {}
const overlays = []

/* 1. Desktop board: a 2040 px window leaves a 1760 px panel (the host keeps a
   280 px sidebar), so the halved master is exactly 2× the README's 880 px. */
await page.setViewport({ width: 2040, height: 1200, deviceScaleFactor: 2 })
await sleep(1500)
overlays.push(await clearOverlays(page, 'board'))
await sleep(400)
const boardCards = await page.evaluate(() => ({
  cards: document.querySelectorAll('.dsh-atb-card').length,
  columns: [...document.querySelectorAll('.dsh-atb-column')].map(column => ({
    status: column.getAttribute('data-status'),
    count: column.querySelectorAll('.dsh-atb-card').length,
  })),
  bar: document.querySelector('[data-atb-bar]')?.getAttribute('data-atb-bar') ?? null,
}))
shots.board = { ...await shootElement('.dsh-atb-panel-root', 'board.png'), ...boardCards }

/* 2. New-task dialog, filled with demo values (never a real user's text). */
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 })
await sleep(900)
await clearOverlays(page, 'modal')
await page.click('.dsh-atb-newmenu > button[data-primary="true"]')
await page.waitForSelector('.dsh-atb-newmenu-list .dsh-atb-newmenu-opt', { timeout: 20_000 })
await page.click('.dsh-atb-newmenu-list .dsh-atb-newmenu-opt')
await page.waitForSelector('.dsh-atb-taskform-modal', { timeout: 20_000 })
await sleep(600)
await page.click('.dsh-atb-taskform-body input')
await page.keyboard.type('Préparer la démo client du 12 mars', { delay: 12 })
await page.click('.dsh-atb-form-right textarea')
await page.keyboard.type(
  'Trois projets fictifs, une trentaine de cartes : vérifier la hiérarchie visuelle, '
  + 'la palette pastel et le rendu du carrousel mobile avant la présentation.',
  { delay: 4 },
)
/* Blur the caret so the shot shows the form, not a focus ring. */
await page.click('.dsh-atb-modal-headtext h3')
await sleep(400)
const modalBox = await shootElement('.dsh-atb-taskform-modal', 'new-task.png')
const modalState = await page.evaluate(() => ({
  mode: document.querySelector('.dsh-atb-taskform-modal')?.getAttribute('data-mode') ?? null,
  title: document.querySelector('.dsh-atb-taskform-body input')?.value ?? null,
  submitEnabled: !document.querySelector('.dsh-atb-modal-footbtns button:last-of-type')?.disabled,
}))
shots.modal = { ...modalBox, ...modalState }
await page.keyboard.press('Escape')
await sleep(500)

/* 3. Phone portrait panel (one column per page, mini column heads). */
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
await sleep(1500)
overlays.push(await clearOverlays(page, 'phone'))
await sleep(400)
const phoneState = await page.evaluate(() => ({
  focus: document.querySelector('[data-atb-focus]')?.getAttribute('data-atb-focus') ?? null,
  columns: document.querySelectorAll('.dsh-atb-column').length,
  tabs: document.querySelectorAll('[role="tab"]').length,
  activeTab: document.querySelector('[role="tab"][data-active], [role="tab"][aria-selected="true"]')?.textContent?.trim().slice(0, 40) ?? null,
}))
shots.phone = { ...await shootElement('.dsh-atb-panel-root', 'phone.png'), ...phoneState }

const appliedTheme = await page.evaluate(() => ({
  dark: document.body.hasAttribute('data-ds-dark-theme'),
  scheme: getComputedStyle(document.documentElement).colorScheme,
}))
writeFileSync(join(outDir, 'readme-shots.json'), JSON.stringify({
  seed: seed.ok, requestedTheme: theme, appliedTheme, overlays, shots,
}, null, 2))
console.log(JSON.stringify({ shots, appliedTheme }, null, 2))
await browser.close()
