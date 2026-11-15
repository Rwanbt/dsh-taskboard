/**
 * Hero screenshots with **fictional** data.
 *
 * Seeds a demo board through the real import route (three invented projects,
 * invented tasks — no real workspace path, project name, task or person) and
 * captures the plugin panel alone (no host chrome) at:
 *   - 1440×900 desktop,
 *   - 390×844 phone portrait,
 *   - 844×390 phone landscape.
 *
 * The demo ledger and the host helpers live in `demo-board.mjs`, shared with
 * `readme-capture.mjs` so both shot sets always show the same fictional board.
 *
 * Driven by `scripts/qa/hero-shots.ps1`, or run directly against a kept host:
 *   PTB_BASE=… PTB_TOKEN=… PTB_OUT=… PTB_BROWSER=… node scripts/qa/hero-capture.mjs
 *
 * @module dsh-taskboard/scripts/qa/hero-capture
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

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  protocolTimeout: 180_000,
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb', '--lang=fr-FR', '--disable-extensions'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
})
const page = await browser.newPage()
page.on('pageerror', error => console.log('pageerror:', String(error)))
// The host follows the OS scheme; the hero is shot in the theme the caller asks
// for (dark by default — the pastel palette on a dark surface). The plugin never
// forces a theme itself.
const theme = (process.env.PTB_THEME ?? 'dark') === 'light' ? 'light' : 'dark'
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
await page.goto(`${base}/?token=${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => document.querySelector('.dsh-atb-board .dsh-atb-card') !== null
  || document.querySelector('button .dsh-atb-pglyph') !== null
  || document.querySelector('[class*="_dialog_"]') !== null, { timeout: 60_000 })

await ensurePanel(page)

/* Seed the demo board through the real import route (same origin, cookie sent). */
const seeded = await seedBoard(page)
console.log('seed:', JSON.stringify(seeded))
writeFileSync(join(outDir, 'hero-seed.json'), JSON.stringify(seeded, null, 2))

/* Force the pastel category colour mode with grouping on, then reload once. */
await page.evaluate(appearance => {
  localStorage.setItem('dsh-taskboard-appearance-v2', JSON.stringify(appearance))
}, DEMO_APPEARANCE)
await page.reload({ waitUntil: 'domcontentloaded' })
await ensurePanel(page)
await page.waitForFunction(() => document.querySelectorAll('.dsh-atb-card').length > 5, { timeout: 60_000 })
await sleep(1500)

/** Clip rectangle of the plugin panel only (no host chrome, no personal data). */
const panelBox = () => page.evaluate(() => {
  const panel = document.querySelector('.dsh-atb-panel-root') ?? document.querySelector('.dsh-atb-board')
  if (panel === null) return null
  const box = panel.getBoundingClientRect()
  return {
    x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height),
    cards: document.querySelectorAll('.dsh-atb-card').length,
    groups: [...document.querySelectorAll('.dsh-atb-ws-group-head')].map(el => el.textContent.trim().slice(0, 30)),
  }
})

const shots = {}
const overlayRecords = []
for (const shape of [
  { name: 'hero-desktop-1440x900', width: 1440, height: 900 },
  { name: 'hero-mobile-390x844', width: 390, height: 844 },
  { name: 'hero-landscape-844x390', width: 844, height: 390 },
]) {
  await page.setViewport({ width: shape.width, height: shape.height, deviceScaleFactor: 2 })
  await sleep(1400)
  // A host overlay can (re)mount at any time (the sign-in wall appears late):
  // clear it again before every shot and prove the board is what is on screen.
  overlayRecords.push(await clearOverlays(page, shape.name))
  await sleep(400)
  const box = await panelBox()
  if (box === null) { console.log('no panel for', shape.name); continue }
  const reachable = await page.evaluate(() => {
    const board = document.querySelector('.dsh-atb-board')
    if (board === null) return { reachable: false }
    const rect = board.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2))
    return {
      reachable: hit !== null && hit.closest('.dsh-atb-board') !== null,
      hit: hit === null ? null : `${hit.tagName}.${String(hit.className).slice(0, 32)}`,
    }
  })
  const file = join(outDir, `${shape.name}.png`)
  await page.screenshot({ path: file, clip: { x: box.x, y: box.y, width: box.width, height: box.height } })
  shots[shape.name] = { ...box, theme, reachable, file }
  console.log(shape.name, JSON.stringify({ ...box, reachable }))
}

const appliedTheme = await page.evaluate(() => ({
  dark: document.body.hasAttribute('data-ds-dark-theme'),
  scheme: getComputedStyle(document.documentElement).colorScheme,
}))
console.log('theme:', JSON.stringify(appliedTheme))
writeFileSync(join(outDir, 'hero-shots.json'), JSON.stringify({ seed: seeded.ok, requestedTheme: theme, appliedTheme, overlays: overlayRecords, shots }, null, 2))
await browser.close()
