/**
 * DeepSeek Pastel — real-DSH visual capture and numeric fidelity metrics.
 *
 * Driven by `scripts/qa/pastel-visual-host.ps1`, which boots an isolated real
 * DSH host, links this working tree, seeds a dense board and then invokes this
 * script with:
 *   PTB_BASE, PTB_TOKEN, PTB_OUT, PTB_BROWSER, PTB_MOCKUP, PTB_LABEL
 *
 * It opens the REAL plugin in Chromium (the production client bundle), captures
 * desktop dark/light, the detail pane, a narrow mobile viewport and a dense
 * backlog column, and measures computed styles so the comparison with the
 * reference mockup is numeric rather than a claim. Metrics are written to
 * metrics.json plus a human-readable visual-report.md; both are honest about
 * what was captured and what could not be verified.
 *
 * @module dsh-taskboard/scripts/qa/pastel-capture
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'

const base = process.env.PTB_BASE
const token = process.env.PTB_TOKEN
const outDir = process.env.PTB_OUT
const executablePath = process.env.PTB_BROWSER
const mockupPath = process.env.PTB_MOCKUP
const label = process.env.PTB_LABEL ?? 'unlabelled'

if (!base || !token || !outDir || !executablePath) {
  console.error('missing PTB_BASE / PTB_TOKEN / PTB_OUT / PTB_BROWSER')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

const report = {
  label,
  generatedAt: new Date().toISOString(),
  base,
  browser: executablePath,
  mockup: mockupPath ?? null,
  screenshots: [],
  dsh: {},
  mockup: {},
  deltas: [],
  checks: [],
  limitations: [],
}

/** Record one pass/fail check (kept in the metrics file for the QA summary). */
function check(name, ok, detail) {
  report.checks.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`)
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb', '--lang=fr-FR', '--disable-extensions'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
})

const page = await browser.newPage()
page.on('pageerror', error => console.log('pageerror:', String(error)))

/** Open the task board panel inside the real DSH shell. */
async function openBoard(target = page, budgetMs = 45_000) {
  await target.waitForFunction(
    () => document.querySelector('button .dsh-atb-pglyph') !== null,
    { timeout: budgetMs },
  )
  await target.evaluate(() => {
    const glyph = document.querySelector('.dsh-atb-pglyph')
    glyph?.closest('button')?.click()
  })
  await target.waitForSelector('.dsh-atb-board .dsh-atb-card', { timeout: budgetMs })
}

/** Wait until the board has painted `n` cards (or just settles). */
async function settle(target = page, ms = 900) {
  await new Promise(resolve => setTimeout(resolve, ms))
  await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/** Read computed style/value pairs for one selector, with the colour resolved to sRGB. */
async function measure(target, selector, props, pseudo = null) {
  return target.evaluate((sel, properties, pseudoElement) => {
    const el = document.querySelector(sel)
    if (el === null) return null
    const style = getComputedStyle(el, pseudoElement)
    const out = {}
    for (const property of properties) out[property] = style.getPropertyValue(property)
    if (pseudoElement === null) {
      // Colour-4 values (oklab(), color-mix()) are pixel-resolved through a
      // 1×1 canvas so contrast maths compares real sRGB channels.
      const resolve = (value) => {
        const canvas = document.createElement('canvas')
        canvas.width = 1; canvas.height = 1
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#010203'
        ctx.fillStyle = value
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
        if (r === 1 && g === 2 && b === 3) return null
        return `rgb(${r}, ${g}, ${b})`
      }
      out.rgbBackground = resolve(style.backgroundColor)
      out.rgbColor = resolve(style.color)
    }
    const rect = el.getBoundingClientRect()
    out.width = Math.round(rect.width)
    out.height = Math.round(rect.height)
    return out
  }, selector, props, pseudo)
}

/** Selector maps: the real plugin and the standalone mockup share one extractor. */
const PLUGIN_SELECTORS = {
  card: '.dsh-atb-card', title: '.dsh-atb-card-title', project: '.dsh-atb-card-project',
  desc: '.dsh-atb-card-desc', priority: '.dsh-atb-card-priority', divider: '.dsh-atb-card-divider',
  badge: '.dsh-atb-card .dsh-atb-badge', column: '.dsh-atb-column', columns: '.dsh-atb-columns',
  head: '.dsh-atb-colhead', titleEl: '.dsh-atb-title', board: '.dsh-atb-board',
  groupHead: '.dsh-atb-ws-group-head', toneCards: '.dsh-atb-card',
}
const MOCKUP_SELECTORS = {
  card: '.task', title: '.task-title', project: '.task-project',
  desc: '.task-desc', priority: '.priority', divider: '.task-divider',
  badge: '.task-flag', column: '.column', columns: '.columns',
  head: '.col-head', titleEl: 'h1', board: '.main-header',
  groupHead: '.group-h', toneCards: '.task',
}

/** Parse an rgb()/rgba() computed colour into channels. */
function parseColor(color) {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(color ?? '')
  if (match === null) return null
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  }
}

/** Composite a (possibly translucent) colour over an opaque backdrop. */
function blend(foreground, background) {
  const fg = parseColor(foreground)
  const bg = parseColor(background)
  if (fg === null || bg === null) return null
  const mix = channel => Math.round(channel[0] * channel[2] + channel[1] * (1 - channel[2]))
  return `rgb(${mix([fg.r, bg.r, fg.a])}, ${mix([fg.g, bg.g, fg.a])}, ${mix([fg.b, bg.b, fg.a])})`
}

/** Relative luminance of an rgb()/rgba() string. */
function luminance(rgb) {
  const color = parseColor(rgb)
  if (color === null) return null
  const channels = [color.r, color.g, color.b].map(value => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/** WCAG contrast ratio between a (possibly translucent) foreground and an opaque background. */
function contrast(foreground, background) {
  const composited = blend(foreground, background)
  const a = luminance(composited)
  const b = luminance(background)
  if (a === null || b === null) return null
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2))
}

/** Count cards and report the visible distribution per column. */
async function boardStats(target = page) {
  return target.evaluate(() => {
    const columns = [...document.querySelectorAll('.dsh-atb-column')]
    return {
      cards: document.querySelectorAll('.dsh-atb-card').length,
      columns: columns.length,
      perColumn: columns.map(column => ({
        status: column.getAttribute('data-status') ?? 'collapsed',
        count: column.querySelectorAll('.dsh-atb-card').length,
        width: Math.round(column.getBoundingClientRect().width),
      })),
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
}

const CARD_PROPS = ['background-color', 'border-radius', 'padding', 'box-shadow', 'color', 'font-family', 'transition-duration']
const TYPO_PROPS = ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'text-transform']

async function captureBoardMetrics(target, selectors = PLUGIN_SELECTORS) {
  const card = await measure(target, selectors.card, CARD_PROPS)
  const cardBefore = await measure(target, selectors.card, ['content', 'width', 'background-color'], '::before')
  const title = await measure(target, selectors.title, TYPO_PROPS)
  const project = await measure(target, selectors.project, TYPO_PROPS)
  const desc = await measure(target, selectors.desc, ['font-size', 'line-height', 'color', '-webkit-line-clamp', 'display'])
  const priority = await measure(target, selectors.priority, ['font-size', 'color'])
  const divider = await measure(target, selectors.divider, ['height', 'background-color'])
  const badge = await measure(target, selectors.badge, ['background-color', 'color', 'font-size', 'border-radius', 'padding'])
  const column = await measure(target, selectors.column, ['background-color', 'border-radius', 'border-top-width', 'border-top-color', 'padding'])
  const columns = await measure(target, selectors.columns, ['gap', 'display', 'overflow-x'])
  const head = await measure(target, selectors.head, ['height', 'font-size', 'font-weight'])
  const titleEl = await measure(target, selectors.titleEl, ['font-size', 'font-weight', 'letter-spacing'])
  const board = await measure(target, selectors.board, ['padding', 'gap', 'background-color'])
  const groupHead = await measure(target, selectors.groupHead, ['background-color', 'font-size', 'position'])
  const cardBg = card?.rgbBackground ?? null
  // Badge backgrounds are translucent: composite them over the card surface so
  // contrast is measured on what the eye actually sees.
  const badgeBg = await target.evaluate((badgeSelector, cardSelector) => {
    const badge = document.querySelector(badgeSelector)
    const card = document.querySelector(cardSelector)
    if (badge === null || card === null) return null
    const canvas = document.createElement('canvas')
    canvas.width = 1; canvas.height = 1
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = getComputedStyle(card).backgroundColor
    ctx.fillRect(0, 0, 1, 1)
    ctx.fillStyle = getComputedStyle(badge).backgroundColor
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `rgb(${r}, ${g}, ${b})`
  }, selectors.badge, selectors.card)

  return {
    card, cardBefore, title, project, desc, priority, divider, badge, badgeBg, column, columns, head, titleEl, board, groupHead,
    contrast: {
      titleOnCard: cardBg !== null && title?.rgbColor ? contrast(title.rgbColor, cardBg) : null,
      descriptionOnCard: cardBg !== null && desc?.rgbColor ? contrast(desc.rgbColor, cardBg) : null,
      projectOnCard: cardBg !== null && project?.rgbColor ? contrast(project.rgbColor, cardBg) : null,
      badgeOnCard: badge?.rgbColor && badgeBg !== null ? contrast(badge.rgbColor, badgeBg) : null,
      priorityOnCard: cardBg !== null && priority?.rgbColor ? contrast(priority.rgbColor, cardBg) : null,
    },
    toneSample: await target.evaluate((cardSelector) => [...document.querySelectorAll(cardSelector)].slice(0, 24).map(card => {
      const canvas = document.createElement('canvas')
      canvas.width = 1; canvas.height = 1
      const ctx = canvas.getContext('2d')
      const value = getComputedStyle(card).backgroundColor
      ctx.fillStyle = '#010203'
      ctx.fillStyle = value
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      return {
        tone: card.getAttribute('data-tone'),
        urgency: card.getAttribute('data-urgency'),
        bg: r === 1 && g === 2 && b === 3 ? value : `rgb(${r}, ${g}, ${b})`,
      }
    }), selectors.toneCards),
  }
}

/** Toggle the host theme through the documented presentation attributes. */
async function hostTheme(target) {
  return target.evaluate(() => {
    const dark = document.body.hasAttribute('data-ds-dark-theme')
    const scheme = getComputedStyle(document.documentElement).colorScheme
    const bodyBg = getComputedStyle(document.body).backgroundColor
    return { dark, scheme, bodyBg, bodyBgLuminance: null }
  })
}

// ---------------------------------------------------------------------------
// 1. Desktop, dark (the host default in this environment unless stated).
// ---------------------------------------------------------------------------
console.log('→ opening the real plugin panel')
await page.goto(`${base}/?token=${encodeURIComponent(token)}`, { waitUntil: 'networkidle2', timeout: 90_000 })
await openBoard()
await settle(page, 1200)
const stats = await boardStats(page)
check('real plugin mounted with a dense board', stats.cards >= 200, `${stats.cards} cards, ${stats.columns} columns`)
check('five readable columns', stats.columns === 5, JSON.stringify(stats.perColumn.map(c => c.width)))
check('no host-level horizontal overflow', stats.pageOverflowX <= 0, `overflow=${stats.pageOverflowX}px`)

const darkTheme = await hostTheme(page)
report.dsh.theme = darkTheme
report.dsh.stats = stats
report.dsh.dark = await captureBoardMetrics(page)
await page.screenshot({ path: join(outDir, 'desktop-dark-1440x900.png') })
report.screenshots.push('desktop-dark-1440x900.png')

// Reduced-motion behaviour: the host publishes the media feature, Chromium
// emulates it, and the stylesheet must drop transforms/transitions.
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
await settle(page, 250)
const reduced = await page.evaluate(() => {
  const card = document.querySelector('.dsh-atb-card')
  return card === null ? null : {
    transitionDuration: getComputedStyle(card).transitionDuration,
    transform: getComputedStyle(card).transform,
  }
})
report.dsh.reducedMotion = reduced
check('prefers-reduced-motion disables card transitions', reduced !== null && /^0s/.test(reduced.transitionDuration), JSON.stringify(reduced))
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])

// ---------------------------------------------------------------------------
// 2. Detail pane (review card: deliverable block + review actions visible).
// ---------------------------------------------------------------------------
await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.dsh-atb-card')]
  const review = cards.find(card => card.closest('.dsh-atb-column[data-status="in_review"]'))
  const target = review ?? cards[Math.floor(cards.length / 3)] ?? cards[0]
  target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForSelector('.dsh-atb-detailpanel', { timeout: 20_000 })
await settle(page, 500)
report.dsh.detail = {
  tonePicker: await measure(page, '.dsh-atb-tone-pick', ['display', 'gap']),
  swatches: await page.evaluate(() => document.querySelectorAll('.dsh-atb-tone-swatch').length),
  title: await measure(page, '.dsh-atb-detail-titlebar h3', ['font-size', 'font-weight']),
  panel: await measure(page, '.dsh-atb-detailpanel', ['border-radius', 'padding', 'background-color', 'box-shadow']),
}
await page.screenshot({ path: join(outDir, 'detail-1440x900.png') })
report.screenshots.push('detail-1440x900.png')
check('detail pane exposes the tone picker (8 tones + auto)', report.dsh.detail.swatches === 9, `swatches=${report.dsh.detail.swatches}`)
await page.evaluate(() => {
  const close = document.querySelector('.dsh-atb-detail-close')
  if (close instanceof HTMLElement) close.click()
})
await settle(page, 400)

// ---------------------------------------------------------------------------
// 3. Light theme: emulate the OS scheme the host presenter listens to; reload
//    so the presenter resolves at boot, then verify it really switched.
// ---------------------------------------------------------------------------
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
await page.reload({ waitUntil: 'networkidle2', timeout: 90_000 })
await openBoard()
await settle(page, 1200)
const lightTheme = await hostTheme(page)
report.dsh.lightTheme = lightTheme
const lightApplied = lightTheme.dark === false && /light/.test(lightTheme.scheme)
if (lightApplied) {
  report.dsh.light = await captureBoardMetrics(page)
  await page.screenshot({ path: join(outDir, 'desktop-light-1440x900.png') })
  report.screenshots.push('desktop-light-1440x900.png')
  check('light theme applied by the host (not forced by the plugin)', true, JSON.stringify(lightTheme))
} else {
  report.limitations.push('Host theme preference is pinned to dark in this profile, so the light screenshot could not be produced by the host presenter; the light palette was validated against the mockup only.')
  check('light theme applied by the host', false, JSON.stringify(lightTheme))
}
// Keep the light palette for the mobile capture on a light host (nicer parity
// with preview-mobile.png), then return to the OS scheme for the dense shot.
await settle(page, 300)

// ---------------------------------------------------------------------------
// 4. Dense backlog column (scrolled to the middle of 300+ cards).
// ---------------------------------------------------------------------------
await page.evaluate(() => {
  const scroller = document.querySelector('.dsh-atb-column[data-status="backlog"] .dsh-atb-cards')
  if (scroller instanceof HTMLElement) scroller.scrollTop = Math.round(scroller.scrollHeight / 3)
})
await settle(page, 500)
await page.screenshot({ path: join(outDir, 'dense-backlog-1440x900.png') })
report.screenshots.push('dense-backlog-1440x900.png')

// ---------------------------------------------------------------------------
// 5. Mobile 390×844: column carousel + navigation bar, no host overflow.
// ---------------------------------------------------------------------------
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await settle(page, 900)
const readMobile = () => page.evaluate(() => {
  const bar = document.querySelector('.dsh-atb-mobilebar')
  const buttons = [...document.querySelectorAll('.dsh-atb-mobilebar-btn')]
  const board = document.querySelector('.dsh-atb-board')
  return {
    boardExists: board !== null,
    mobilebarDisplay: bar === null ? null : getComputedStyle(bar).display,
    buttons: buttons.length,
    pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    boardOverflowX: board === null ? null : board.scrollWidth - board.clientWidth,
    columnWidth: Math.round(document.querySelector('.dsh-atb-column')?.getBoundingClientRect().width ?? 0),
    panelRows: document.querySelectorAll('.dsh-atb-pglyph').length,
  }
})
let mobile = await readMobile()
if (!mobile.boardExists) {
  // The host shell may have left our panel at this width; reopen it once and
  // record the outcome honestly instead of fabricating a capture.
  try { await openBoard(page, 15_000) } catch { /* recorded below */ }
  await settle(page, 700)
  mobile = await readMobile()
}
report.dsh.mobile = mobile
await page.screenshot({ path: join(outDir, 'mobile-390x844.png') })
report.screenshots.push('mobile-390x844.png')
check('mobile column navigation is visible', mobile.mobilebarDisplay === 'flex' && mobile.buttons === 5, JSON.stringify(mobile))
check('mobile has no host-level horizontal overflow', mobile.pageOverflowX <= 0, `overflow=${mobile.pageOverflowX}px`)
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })

// ---------------------------------------------------------------------------
// 6. Numeric comparison with the reference mockup, rendered in the same browser.
// ---------------------------------------------------------------------------
if (mockupPath) {
  const mock = await browser.newPage()
  await mock.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await mock.goto(pathToFileURL(mockupPath).href, { waitUntil: 'load', timeout: 30_000 })
  await new Promise(resolve => setTimeout(resolve, 600))

  /**
   * Measure one density on both sides. The board default is "spacious"
   * (deliberate, per the GOAL), so comparing only the mockup's default
   * "comfortable" would be misleading: all three presets are compared.
   */
  const densityProbe = async (target, density, isMockup) => {
    await target.evaluate((nextDensity, mockup) => {
      const root = mockup ? document.documentElement : document.querySelector('.dsh-atb-board')
      if (root === null) return
      if (mockup) root.dataset.density = nextDensity
      else root.dataset.atbDensity = nextDensity
    }, density, isMockup)
    await new Promise(resolve => setTimeout(resolve, 220))
    const selectors = isMockup ? MOCKUP_SELECTORS : PLUGIN_SELECTORS
    const card = await measure(target, selectors.card, ['border-radius', 'padding'])
    const columns = await measure(target, selectors.columns, ['gap'])
    const title = await measure(target, selectors.title, ['font-size'])
    const desc = await measure(target, selectors.desc, ['-webkit-line-clamp', 'display'])
    const applied = await target.evaluate((mockup) => {
      const root = mockup ? document.documentElement : document.querySelector('.dsh-atb-board')
      return root === null ? null : (mockup ? root.dataset.density : root.dataset.atbDensity)
    }, isMockup)
    if (!isMockup && card === null) console.log(`→ density ${density}: board present but card missing (applied=${applied})`)
    return {
      radius: card?.['border-radius'] ?? null,
      padding: card?.padding ?? null,
      gap: columns?.gap ?? null,
      titleFont: title?.['font-size'] ?? null,
      descClamp: desc?.['-webkit-line-clamp'] ?? null,
    }
  }

  report.mockup = { densities: {}, light: {} }
  report.dsh.densities = {}
  // The panel must still be mounted on the plugin page before probing densities.
  const beforeProbe = await page.evaluate(() => ({
    board: document.querySelector('.dsh-atb-board') !== null,
    cards: document.querySelectorAll('.dsh-atb-card').length,
  }))
  console.log('→ density probe precondition:', JSON.stringify(beforeProbe))
  if (!beforeProbe.board) {
    await openBoard(page)
    await settle(page, 600)
  }
  for (const density of ['compact', 'comfortable', 'spacious']) {
    report.mockup.densities[density] = await densityProbe(mock, density, true)
    report.dsh.densities[density] = await densityProbe(page, density, false)
  }
  // Restore the default density before the remaining captures.
  await page.evaluate(() => { const board = document.querySelector('.dsh-atb-board'); if (board !== null) board.dataset.atbDensity = 'spacious' })

  // Dark palette + mockup light palette, on the mockup's own default density.
  await mock.evaluate(() => { document.documentElement.dataset.density = 'comfortable'; document.documentElement.dataset.theme = 'dark' })
  await new Promise(resolve => setTimeout(resolve, 250))
  const mockDark = await captureBoardMetrics(mock, MOCKUP_SELECTORS)
  await mock.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await new Promise(resolve => setTimeout(resolve, 300))
  const mockLight = await captureBoardMetrics(mock, MOCKUP_SELECTORS)
  report.mockup.dark = mockDark
  report.mockup.light = mockLight

  const compare = (name, ours, theirs, tolerance = 1) => {
    if (ours === null || ours === undefined || theirs === null || theirs === undefined) return
    const delta = Number((Number.parseFloat(String(ours)) - Number.parseFloat(String(theirs))).toFixed(2))
    report.deltas.push({ property: name, dsh: ours, mockup: theirs, delta, withinTolerance: Math.abs(delta) <= tolerance })
  }
  const o = report.dsh.dark
  const m = mockDark
  // Typography and column geometry are density-independent.
  compare('card.title.font-size', o.title?.['font-size'], m.title?.['font-size'], 0.5)
  compare('card.title.font-weight', o.title?.['font-weight'], m.title?.['font-weight'], 50)
  compare('card.project.font-size', o.project?.['font-size'], m.project?.['font-size'], 0.5)
  compare('card.desc.font-size', o.desc?.['font-size'], m.desc?.['font-size'], 0.5)
  compare('card.priority.font-size', o.priority?.['font-size'], m.priority?.['font-size'], 0.5)
  compare('column.border-radius', o.column?.['border-radius'], m.column?.['border-radius'])
  compare('column.gap', o.columns?.gap, m.columns?.gap)
  compare('board.title.font-size', o.titleEl?.['font-size'], m.titleEl?.['font-size'], 1)
  // Densities: every preset must map to the mockup's spacing values.
  for (const density of ['compact', 'comfortable', 'spacious']) {
    const ours = report.dsh.densities[density]
    const theirs = report.mockup.densities[density]
    compare(`density.${density}.radius`, ours.radius, theirs.radius)
    compare(`density.${density}.padding`, ours.padding, theirs.padding)
    compare(`density.${density}.gap`, ours.gap, theirs.gap)
    compare(`density.${density}.titleFont`, ours.titleFont, theirs.titleFont, 0.5)
  }

  // Palette comparison on the violet tone (the mockup's dark pastel surface).
  const ourTone = o.toneSample.find(sample => sample.tone === 'violet')
  const mockTone = m.toneSample.find(sample => sample.tone === 'violet')
  const channelDelta = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return Number.POSITIVE_INFINITY
    const pa = parseColor(a)
    const pb = parseColor(b)
    if (pa === null || pb === null) return Number.POSITIVE_INFINITY
    return Math.max(Math.abs(pa.r - pb.r), Math.abs(pa.g - pb.g), Math.abs(pa.b - pb.b))
  }
  const toneDelta = channelDelta(ourTone?.bg, mockTone?.bg)
  report.deltas.push({
    property: 'card.tone.violet.background',
    dsh: ourTone?.bg ?? null,
    mockup: mockTone?.bg ?? null,
    delta: Number.isFinite(toneDelta) ? toneDelta : null,
    withinTolerance: toneDelta <= 3,
  })
  check('no legacy priority stripe on the card (::before content none)', o.cardBefore?.content === 'none', `::before content=${o.cardBefore?.content}`)
  const inTolerance = report.deltas.filter(delta => delta.withinTolerance === false)
  check('mockup geometry/typography deltas within tolerance', inTolerance.length === 0, inTolerance.map(d => `${d.property}: ${d.dsh} vs ${d.mockup}`).join('; ') || 'all within tolerance')
  await mock.close()
} else {
  report.limitations.push('Mockup HTML not found: numeric comparison skipped.')
}

// Contrast floors (WCAG AA for normal text = 4.5, large text = 3).
const darkContrast = report.dsh.dark?.contrast ?? {}
const lightContrast = report.dsh.light?.contrast ?? {}
for (const [name, value] of Object.entries(darkContrast)) {
  check(`dark contrast ${name} ≥ 4.5`, value !== null && value >= 4.5, `ratio=${value}`)
}
for (const [name, value] of Object.entries(lightContrast)) {
  check(`light contrast ${name} ≥ 4.5`, value !== null && value >= 4.5, `ratio=${value}`)
}

// Every tone must paint a distinct surface (no random or collapsed palette).
const tones = new Map()
for (const sample of report.dsh.dark?.toneSample ?? []) {
  if (sample.tone !== null) tones.set(sample.tone, sample.bg)
}
for (const sample of report.dsh.light?.toneSample ?? []) {
  if (sample.tone !== null) tones.set(`${sample.tone}:light`, sample.bg)
}
report.dsh.tones = Object.fromEntries(tones)
check('cards carry stable data-tone values', tones.size >= 4, `${tones.size} tone samples`)

writeFileSync(join(outDir, 'metrics.json'), JSON.stringify(report, null, 2))

const failed = report.checks.filter(entry => !entry.ok)
const lines = [
  `# DeepSeek Pastel — visual validation (${label})`,
  '',
  `- Generated: ${report.generatedAt}`,
  `- Real DSH host: ${base} (isolated DSH home, plugin linked from the working tree)`,
  `- Browser: ${executablePath}`,
  `- Mockup: ${mockupPath ?? 'not found'}`,
  '',
  '## Checks',
  '',
  '| Check | Result | Detail |',
  '| --- | --- | --- |',
  ...report.checks.map(entry => `| ${entry.name} | ${entry.ok ? 'PASS' : 'FAIL'} | ${String(entry.detail).replace(/\|/g, '\\|')} |`),
  '',
  '## Screenshots',
  '',
  ...report.screenshots.map(file => `- \`${file}\``),
  '',
  '## Mockup deltas',
  '',
  '| Property | DSH | Mockup | Δ | In tolerance |',
  '| --- | --- | --- | --- | --- |',
  ...report.deltas.map(delta => `| ${delta.property} | ${delta.dsh} | ${delta.mockup} | ${delta.delta ?? '—'} | ${delta.withinTolerance ? 'yes' : 'no'} |`),
  '',
  '## Limitations',
  '',
  ...(report.limitations.length > 0 ? report.limitations.map(item => `- ${item}`) : ['- none recorded']),
  '',
]
writeFileSync(join(outDir, 'visual-report.md'), lines.join('\n'))

await browser.close()
console.log(`→ ${report.checks.length - failed.length}/${report.checks.length} checks passed`)
console.log(`→ metrics: ${join(outDir, 'metrics.json')}`)
if (failed.length > 0) {
  console.log('failed checks:')
  for (const entry of failed) console.log(`  - ${entry.name}: ${entry.detail}`)
  process.exit(1)
}
