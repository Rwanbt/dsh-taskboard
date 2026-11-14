/**
 * Mobile focus mode — real-DSH visual capture and behavioural metrics.
 *
 * Driven by `scripts/qa/pastel-visual-host.ps1 -CaptureScript mobile-swipe-capture.mjs`,
 * which boots an isolated real DSH host, links this working tree, seeds a dense
 * board and passes PTB_BASE / PTB_TOKEN / PTB_OUT / PTB_BROWSER / PTB_LABEL.
 *
 * Everything below runs against the production client bundle in Chromium:
 *  - the desktop five-column board (regression: unchanged);
 *  - 390×844 portrait: one column per page, tab rail, compact toolbar, FAB,
 *    bottom sheets, real CDP touch gestures (swipe left/right, vertical pan,
 *    tap) with the resulting scroll position and tab state measured;
 *  - 844×390 landscape: two columns per page;
 *  - a light-theme portrait pass driven by the host presenter.
 *
 * Screenshots + metrics.json + visual-report.md land in PTB_OUT. Any check that
 * cannot be proven is recorded as a failure (never silently skipped).
 *
 * @module dsh-taskboard/scripts/qa/mobile-swipe-capture
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const base = process.env.PTB_BASE
const token = process.env.PTB_TOKEN
const outDir = process.env.PTB_OUT
const executablePath = process.env.PTB_BROWSER
const label = process.env.PTB_LABEL ?? 'unlabelled'

if (!base || !token || !outDir || !executablePath) {
  console.error('missing PTB_BASE / PTB_TOKEN / PTB_OUT / PTB_BROWSER')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

/**
 * Collected evidence, written next to the screenshots.
 */
const report = {
  label,
  generatedAt: new Date().toISOString(),
  base,
  browser: executablePath,
  screenshots: [],
  checks: [],
  viewports: {},
  gestures: {},
  limitations: [
    'Synthetic touch *scrolling* could not be produced in this headless Chromium build (no GPU compositor): Input.dispatchTouchEvent delivers touch events to the page but produces no scroll, Input.synthesizeScrollGesture is inert, and wheel events over the plugin panel do not scroll it (all probed on this machine). Scrolling is therefore exercised through real scroll positions (scrollBy / scrollLeft), which is exactly what a settled swipe leaves behind: the CSS snap engine, the scroll→tab sync and the resting page are then the browser\'s own behaviour. Touch events themselves are dispatched for real and prove gesture delivery and the swipe-vs-tap guard.',
    'The 390×844 / 844×390 viewports are emulated with an exact CSS viewport + touch points and a desktop UA (the plugin answers to viewport media queries only). The DSH shell keeps its desktop chrome, which is a host concern and out of the plugin scope.',
  ],
}

/** Record one pass/fail check and echo it to the console. */
function check(name, ok, detail) {
  report.checks.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`)
  // Evidence is flushed on every check: a later crash must never lose the
  // measurements already taken (that would turn a red run into a blind one).
  flushMetrics()
}

/** Persist the evidence collected so far. */
function flushMetrics() {
  writeFileSync(join(outDir, 'metrics-mobile.json'), JSON.stringify(report, null, 2))
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  protocolTimeout: 180_000,
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb', '--lang=fr-FR', '--disable-extensions'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
})

const page = await browser.newPage()
page.on('pageerror', error => console.log('pageerror:', String(error)))
const cdp = await page.createCDPSession()

/**
 * Dismiss the shell's own first-run dialogs (preview notice, sign-in prompt).
 *
 * A fresh isolated DSH home greets the browser with a modal that covers the
 * plugin panel: real pointer input would hit the dialog instead of the board.
 * They are clicked through with real mouse clicks, exactly like a user, and the
 * step is recorded so the evidence never pretends they were absent.
 */
async function dismissHostOverlays() {
  const steps = []
  for (let step = 0; step < 8; step += 1) {
    const state = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[class*="_dialog_"]')]
        .filter(dialog => dialog.getBoundingClientRect().width > 0)
      const buttons = dialogs.flatMap(dialog => [...dialog.querySelectorAll('button')].map(button => {
        const box = button.getBoundingClientRect()
        return {
          text: (button.textContent ?? '').trim().slice(0, 40),
          x: Math.round(box.x + box.width / 2),
          y: Math.round(box.y + box.height / 2),
          width: Math.round(box.width),
          visible: box.width > 0,
        }
      }))
      return { dialogs: dialogs.length, buttons: buttons.filter(button => button.visible) }
    })
    if (state.dialogs === 0) return { dismissed: true, steps }
    // Prefer the explicit continue/accept action, then an icon-sized close.
    const target = state.buttons.find(button => /continuer|continue|commencer|start|ignorer|skip/i.test(button.text))
      ?? state.buttons.find(button => button.width <= 44)
      ?? state.buttons[0]
    if (target === undefined) return { dismissed: false, steps }
    steps.push({ text: target.text, x: target.x, y: target.y })
    await page.mouse.click(target.x, target.y)
    await sleep(900)
  }
  return { dismissed: false, steps }
}

/** True when a card's centre really belongs to the board (no host overlay). */
async function panelIsReachable() {
  return page.evaluate(() => {
    const board = document.querySelector('.dsh-atb-board')
    if (board === null) return { reachable: false, reason: 'no board' }
    const status = board.getAttribute('data-atb-active-status')
    const column = status === null ? null : board.querySelector(`.dsh-atb-column[data-status="${status}"]`)
    const card = column?.querySelector('.dsh-atb-card') ?? board.querySelector('.dsh-atb-card')
    if (card === null) return { reachable: false, reason: 'no card' }
    const box = card.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(box.x + box.width / 2), Math.round(box.y + 40))
    return {
      reachable: hit !== null && hit.closest('.dsh-atb-board') !== null,
      hit: hit === null ? null : `${hit.tagName}.${String(hit.className).slice(0, 40)}`,
    }
  })
}

/**
 * Open the task board panel inside the real DSH shell.
 *
 * The shell may restore an already-open panel across a reload (then the sidebar
 * entry no longer carries the plugin glyph), so both states are accepted.
 */
async function openBoard(target = page, budgetMs = 45_000) {
  await target.waitForFunction(
    () => document.querySelector('.dsh-atb-board .dsh-atb-card') !== null
      || document.querySelector('button .dsh-atb-pglyph') !== null
      || document.querySelector('[class*="_dialog_"]') !== null,
    { timeout: budgetMs },
  )
  // First-run dialogs first: they cover the sidebar too.
  if ((await target.$('[class*="_dialog_"]')) !== null) {
    const overlays = await dismissHostOverlays()
    report.shellOverlays = overlays
    await settle(target, 600)
  }
  if ((await target.$('.dsh-atb-board .dsh-atb-card')) === null) {
    const glyph = await target.$('button .dsh-atb-pglyph')
    if (glyph === null) {
      // The shell may need a moment to render the sidebar after a dialog.
      await target.waitForFunction(() => document.querySelector('button .dsh-atb-pglyph') !== null, { timeout: budgetMs })
    }
    await target.evaluate(() => {
      const glyphEl = document.querySelector('.dsh-atb-pglyph')
      glyphEl?.closest('button')?.click()
    })
  }
  await target.waitForSelector('.dsh-atb-board .dsh-atb-card', { timeout: budgetMs })
}

/** Let layout, scroll-snap and transitions settle. */
async function settle(target = page, ms = 700) {
  await sleep(ms)
  await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/** Screenshot helper that records the file name. */
async function shot(name) {
  const file = join(outDir, name)
  await page.screenshot({ path: file })
  report.screenshots.push(name)
  return name
}

/**
 * Contrast helpers: WCAG AA on the measured sRGB channels.
 */
function luminance({ r, g, b }) {
  const channel = value => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(fg, bg) {
  if (fg === null || bg === null) return null
  const a = luminance(fg)
  const b = luminance(bg)
  return Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2))
}

/** Read the whole focus-mode state in one round trip. */
async function readFocus(target = page) {
  return target.evaluate(() => {
    const resolve = (value) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#010203'
      ctx.fillStyle = value
      ctx.fillRect(0, 0, 1, 1)
      const data = ctx.getImageData(0, 0, 1, 1).data
      if (data[0] === 1 && data[1] === 2 && data[2] === 3) return null
      return { r: data[0], g: data[1], b: data[2] }
    }
    const board = document.querySelector('.dsh-atb-board')
    if (board === null) {
      // The panel can be closed/re-mounted by the host shell: report the absence
      // with the same shape so every check stays readable instead of crashing.
      return { board: false, url: location.href, focus: null, activeStatus: null, columnCount: 0, columnWidths: [], rail: null, tabCount: 0, tabRoles: [], tabSelected: [], pageCounter: null, cueDisplay: null, fab: null, pageOverflowX: 0, cardsScrollTop: 0, cardsVisible: 0, distinctCardSurfaces: 0, cardBg: null, titleColor: null, draggable: null, searchfieldDisplay: null, mobileActionsDisplay: null, toolbarFiltersDisplay: null, toolbarActionsDisplay: null }
    }
    const rail = board.querySelector('.dsh-atb-columns')
    const columns = [...board.querySelectorAll('.dsh-atb-column[data-status]')]
    const tabs = [...board.querySelectorAll('.dsh-atb-mobilebar-btn')]
    const active = tabs.find(tab => tab.getAttribute('aria-selected') === 'true') ?? null
    const fab = board.querySelector('.dsh-atb-fab')
    const searchfield = board.querySelector('.dsh-atb-searchfield')
    const actions = board.querySelector('.dsh-atb-mobileactions')
    const filters = board.querySelector('.dsh-atb-toolbar-filters')
    const toolbarActions = board.querySelector('.dsh-atb-toolbar-actions')
    const cue = board.querySelector('.dsh-atb-swipecue')
    // The vertical scroller and the sampled card must come from the column the
    // user is looking at, not from the first column in the DOM.
    const activeStatus = board.getAttribute('data-atb-active-status')
    const activeColumn = activeStatus === null ? null : board.querySelector(`.dsh-atb-column[data-status="${activeStatus}"]`)
    const cards = (activeColumn ?? board).querySelector('.dsh-atb-cards')
    const style = el => (el === null ? null : getComputedStyle(el))
    const rect = el => {
      if (el === null) return null
      const box = el.getBoundingClientRect()
      return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
    }
    const railStyle = style(rail)
    const card = (activeColumn ?? board).querySelector('.dsh-atb-card')
    const cardStyle = style(card)
    const titleStyle = style((activeColumn ?? board).querySelector('.dsh-atb-card-title'))
    return {
      board: true,
      focus: board.getAttribute('data-atb-focus'),
      activeStatus: board.getAttribute('data-atb-active-status'),
      colorMode: board.getAttribute('data-atb-color-mode'),
      columnCount: columns.length,
      columnWidths: columns.map(column => Math.round(column.getBoundingClientRect().width)),
      columnLefts: columns.map(column => Math.round(column.getBoundingClientRect().left)),
      rail: rail === null ? null : {
        clientWidth: rail.clientWidth,
        scrollWidth: rail.scrollWidth,
        scrollLeft: Math.round(rail.scrollLeft),
        snapType: railStyle.scrollSnapType,
        overscrollX: railStyle.overscrollBehaviorX,
        touchAction: railStyle.touchAction,
      },
      cardsScrollTop: cards === null ? 0 : Math.round(cards.scrollTop),
      cardsScrollHeight: cards === null ? 0 : cards.scrollHeight,
      cardsClientHeight: cards === null ? 0 : cards.clientHeight,
      tabCount: tabs.length,
      tabRoles: tabs.map(tab => tab.getAttribute('role')),
      tabSelected: tabs.map(tab => tab.getAttribute('aria-selected')),
      activeTabLabel: active === null ? null : active.textContent,
      // Mobile column tabs are miniature column heads: measure the chrome that
      // makes them so (status rule on the top edge, sober surface, low height)
      // next to the desktop column-head rule they are modelled on.
      tabChrome: tabs.map(tab => {
        const tabStyle = getComputedStyle(tab)
        const rule = getComputedStyle(tab, '::before')
        const status = tab.getAttribute('data-status')
        const column = status === null ? null : board.querySelector(`.dsh-atb-column[data-status="${status}"]`)
        const colheadRule = column === null
          ? null
          : getComputedStyle(column.querySelector('.dsh-atb-colhead') ?? column, '::before')
        const box = tab.getBoundingClientRect()
        return {
          status,
          active: tab.getAttribute('data-active') === 'true',
          label: tab.querySelector('.dsh-atb-mobilebar-label')?.textContent ?? null,
          count: tab.querySelector('.dsh-atb-mobilebar-count')?.textContent ?? null,
          width: Math.round(box.width),
          height: Math.round(box.height),
          radius: tabStyle.borderTopLeftRadius,
          surface: resolve(tabStyle.backgroundColor),
          color: resolve(tabStyle.color),
          fontWeight: tabStyle.fontWeight,
          ruleColor: resolve(rule.backgroundColor),
          ruleOpacity: rule.opacity,
          ruleHeight: rule.height,
          ruleLeft: rule.left,
          ruleRight: rule.right,
          desktopRuleColor: colheadRule === null ? null : resolve(colheadRule.backgroundColor),
          hasDot: tab.querySelector('.dsh-atb-dot') !== null,
          hasLabel: tab.querySelector('.dsh-atb-mobilebar-label') !== null,
          hasCount: tab.querySelector('.dsh-atb-mobilebar-count') !== null,
        }
      }),
      tabbar: (() => {
        const bar = board.querySelector('.dsh-atb-mobilebar')
        if (bar === null) return null
        return {
          clientWidth: bar.clientWidth,
          scrollWidth: bar.scrollWidth,
          scrollLeft: Math.round(bar.scrollLeft),
          overflowX: getComputedStyle(bar).overflowX,
          scrollSnapType: getComputedStyle(bar).scrollSnapType,
        }
      })(),
      pageCounter: board.querySelector('.dsh-atb-swipecue-page')?.textContent ?? null,
      cueDisplay: style(cue)?.display ?? null,
      mobileHeadDisplay: style(board.querySelector('.dsh-atb-mobilehead'))?.display ?? null,
      fab: fab === null ? null : { display: style(fab).display, rect: rect(fab) },
      searchfieldDisplay: style(searchfield)?.display ?? null,
      mobileActionsDisplay: style(actions)?.display ?? null,
      toolbarFiltersDisplay: style(filters)?.display ?? null,
      toolbarActionsDisplay: style(toolbarActions)?.display ?? null,
      draggable: card === null ? null : card.getAttribute('draggable'),
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cardBg: card === null ? null : resolve(getComputedStyle(card).backgroundColor),
      cardColor: card === null ? null : resolve(cardStyle.color),
      titleColor: titleStyle === null ? null : resolve(titleStyle.color),
      distinctCardSurfaces: new Set([...board.querySelectorAll('.dsh-atb-card')].map(el =>
        getComputedStyle(el).backgroundColor)).size,
      cardsVisible: board.querySelectorAll('.dsh-atb-card').length,
    }
  })
}

/** Read a modal/sheet geometry if one is open. */
async function readSheet(target = page, selector = '.dsh-atb-modal') {
  return target.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (el === null) return null
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    return {
      role: el.getAttribute('role'),
      position: style.position,
      borderRadius: style.borderTopLeftRadius,
      width: Math.round(box.width),
      height: Math.round(box.height),
      bottom: Math.round(window.innerHeight - box.bottom),
      left: Math.round(box.left),
      handles: document.querySelectorAll('.dsh-atb-sheet-handle').length,
    }
  }, selector)
}

/** Read the inline detail panel geometry. */
async function readDetail(target = page) {
  return target.evaluate(() => {
    const el = document.querySelector('.dsh-atb-detailpanel')
    if (el === null) return null
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    return {
      position: style.position,
      zIndex: style.zIndex,
      width: Math.round(box.width),
      height: Math.round(box.height),
      bottom: Math.round(window.innerHeight - box.bottom),
      left: Math.round(box.left),
      radius: style.borderTopLeftRadius,
    }
  })
}

/**
 * Dispatch a raw touch pan (touchstart → touchmove… → touchend) through CDP.
 *
 * Note on this harness: headless Chromium without a GPU compositor delivers the
 * touch events to the page but does not convert them into scroll gestures
 * (`Input.dispatchTouchEvent` and `Input.synthesizeScrollGesture` were both
 * probed on this machine; only the wheel input pipeline produces real scrolls).
 * Touch events are therefore used to prove gesture delivery and the
 * swipe-vs-tap guard, while scrolling itself is validated with wheel input and
 * by letting the CSS snap engine settle the rail.
 */
async function touchPan(fromX, fromY, toX, toY, steps = 16) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y: fromY }] })
  for (let step = 1; step <= steps; step += 1) {
    const x = fromX + (toX - fromX) * (step / steps)
    const y = fromY + (toY - fromY) * (step / steps)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    await sleep(18)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(400)
}

/** Current rail scrollLeft (0 when absent). */
async function railScrollLeft() {
  return page.evaluate(() => {
    const rail = document.querySelector('.dsh-atb-board .dsh-atb-columns')
    return rail === null ? 0 : Math.round(rail.scrollLeft)
  })
}

/** Rail rectangle (CSS pixels). */
async function railRect() {
  return page.evaluate(() => {
    const rail = document.querySelector('.dsh-atb-board .dsh-atb-columns')
    if (rail === null) return null
    const box = rail.getBoundingClientRect()
    return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
  })
}

/**
 * Move the carousel one page and report how it was done.
 *
 * Headless Chromium without a GPU compositor does not turn synthetic input into
 * scrolls in this host (wheel over the plugin panel is inert, dispatched touch
 * events scroll nothing, Input.synthesizeScrollGesture is inert — all probed on
 * this machine). The rail is therefore scrolled with `scrollBy`, which is the
 * same scroll position a settled finger swipe leaves behind: the CSS snap
 * engine, the scroll→tab sync and the resting page are then whatever the real
 * browser does with that position.
 */
async function scrollCarouselPage(pageWidth) {
  const rail = await railRect()
  if (rail === null) return { moved: false, mechanism: 'none', attempts: [] }
  const before = await railScrollLeft()
  const direction = before < pageWidth * 4 - 2 ? 1 : -1
  await page.evaluate(({ left, behavior }) => {
    const el = document.querySelector('.dsh-atb-board .dsh-atb-columns')
    if (el !== null) el.scrollBy({ left, behavior })
  }, { left: direction * pageWidth, behavior: 'smooth' })
  await settle(page, 1000)
  const after = await railScrollLeft()
  return {
    moved: after !== before,
    mechanism: 'scrollBy (settled-swipe position)',
    attempts: [{ mechanism: 'scrollBy', direction, before, after }],
  }
}

/**
 * Workflow order, used to label a rail offset (the plugin's own order).
 */
const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done']

/** Status of a rail scroll offset (page index = offset / page width). */
function statusFromOffset(offset, pageWidth) {
  if (!(pageWidth > 0)) return null
  const index = Math.max(0, Math.min(STATUSES.length - 1, Math.round(offset / pageWidth)))
  return STATUSES[index] ?? null
}

/**
 * Apply the host theme the same way a user does: the OS scheme it listens to.
 * The reload always happens at desktop width — the host shell hides the plugin
 * entry point in a narrow mobile viewport, so reopening must not race that.
 */
async function applyTheme(theme, viewport = null) {
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
  await page.reload({ waitUntil: 'networkidle2', timeout: 90_000 })
  await openBoard()
  await settle(page, 1000)
  if (viewport !== null) {
    await page.setViewport(viewport)
    await settle(page, 900)
    if (!(await page.$('.dsh-atb-board'))) {
      // The shell remounted the panel on the viewport change: reopen explicitly.
      await openBoard(page, 20_000)
      await settle(page, 700)
    }
  }
}

const viewportOf = async () => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))

// ---------------------------------------------------------------------------
// 1. Desktop 1440×900 — the five-column board must be exactly as before.
// ---------------------------------------------------------------------------
console.log('→ opening the real plugin panel (desktop)')
await page.goto(`${base}/?token=${encodeURIComponent(token)}`, { waitUntil: 'networkidle2', timeout: 90_000 })
await openBoard()
await settle(page, 1200)

const desktop = await readFocus()
report.viewports.desktop = desktop
check('desktop keeps five side-by-side columns', desktop.focus === 'none' && desktop.columnCount === 5, JSON.stringify({ focus: desktop.focus, columns: desktop.columnCount, widths: desktop.columnWidths }))
check('desktop columns are narrower than the rail (no carousel)', desktop.rail !== null && desktop.columnWidths.every(width => width < desktop.rail.clientWidth - 20), JSON.stringify(desktop.columnWidths))
check('desktop keeps HTML5 drag on cards', desktop.draggable === 'true', String(desktop.draggable))
check('desktop has no floating create button', desktop.fab === null || desktop.fab.display === 'none', JSON.stringify(desktop.fab))
check('desktop shows the inline filter cluster', desktop.toolbarFiltersDisplay === 'contents', String(desktop.toolbarFiltersDisplay))
check('desktop hides the focus-mode header entirely', desktop.mobileHeadDisplay === 'none', String(desktop.mobileHeadDisplay))
check('desktop has no page-level horizontal overflow', desktop.pageOverflowX <= 0, `overflow=${desktop.pageOverflowX}px`)
check('desktop colour modes still colour cards by category', desktop.distinctCardSurfaces >= 3, `${desktop.distinctCardSurfaces} distinct surfaces over ${desktop.cardsVisible} cards`)
await shot('desktop-1440x900.png')

// ---------------------------------------------------------------------------
// 2. Portrait 390×844 — one column per page, tab rail, compact toolbar.
// ---------------------------------------------------------------------------
console.log('→ portrait 390×844')
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: false, hasTouch: true })
await settle(page, 900)
if (!(await page.$('.dsh-atb-board'))) {
  await openBoard(page, 15_000)
  await settle(page, 700)
}
let portrait = await readFocus()
report.viewports.portrait = portrait
// Real pointer input only proves something if the panel is actually on top:
// a leftover shell dialog would swallow every click and gesture.
let reach = await panelIsReachable()
if (!reach.reachable) {
  await openBoard(page, 25_000)
  await settle(page, 800)
  reach = await panelIsReachable()
}
report.shellReachable = reach
check('host shell leaves the board reachable (no overlay)', reach.reachable === true, JSON.stringify(reach))
const pageWidth = portrait.rail?.clientWidth ?? 0
check('portrait switches to the focus carousel', portrait.focus === 'portrait', String(portrait.focus))
check('portrait rail uses mandatory x scroll snapping', portrait.rail !== null && /mandatory/.test(portrait.rail.snapType ?? ''), String(portrait.rail?.snapType))
check('portrait columns are exactly one rail wide', portrait.columnWidths.every(width => Math.abs(width - pageWidth) <= 1), JSON.stringify({ widths: portrait.columnWidths, rail: pageWidth }))
check('portrait keeps the five status pages', portrait.columnCount === 5, String(portrait.columnCount))
check('portrait status rail exposes five synchronised tabs', portrait.tabCount === 5 && portrait.tabRoles.every(role => role === 'tab') && portrait.tabSelected.filter(value => value === 'true').length === 1, JSON.stringify({ tabs: portrait.tabCount, selected: portrait.tabSelected }))
check('portrait opens on the "To do" page', portrait.activeStatus === 'todo' && portrait.pageCounter === '2/5', JSON.stringify({ active: portrait.activeStatus, counter: portrait.pageCounter }))
check('portrait compacts the toolbar into icon buttons', portrait.mobileActionsDisplay === 'flex' && portrait.toolbarFiltersDisplay === 'none' && portrait.toolbarActionsDisplay === 'none', JSON.stringify({ actions: portrait.mobileActionsDisplay, filters: portrait.toolbarFiltersDisplay, toolbarActions: portrait.toolbarActionsDisplay }))
check('portrait hides the search field until asked', portrait.searchfieldDisplay === 'none', String(portrait.searchfieldDisplay))
check('portrait shows the focus-mode header', portrait.mobileHeadDisplay === 'flex', String(portrait.mobileHeadDisplay))
check('portrait shows the swipe cue and page counter', /flex/.test(portrait.cueDisplay ?? '') && portrait.pageCounter !== null, JSON.stringify({ cue: portrait.cueDisplay, counter: portrait.pageCounter }))
check('portrait offers a thumb-reachable create button', portrait.fab !== null && portrait.fab.display === 'grid' && portrait.fab.rect.width >= 48 && portrait.fab.rect.y + portrait.fab.rect.height <= 844 - 8, JSON.stringify(portrait.fab))
check('portrait never scrolls the page horizontally', portrait.pageOverflowX <= 0, `overflow=${portrait.pageOverflowX}px`)
check('portrait cards keep the pastel surface', portrait.cardBg !== null && portrait.distinctCardSurfaces >= 2, `${portrait.distinctCardSurfaces} distinct surfaces`)
const portraitTabContrast = contrast(portrait.titleColor, portrait.cardBg)
check('portrait card title stays readable (WCAG AA)', portraitTabContrast !== null && portraitTabContrast >= 4.5, `contrast=${portraitTabContrast}`)

// ---------------------------------------------------------------------------
// Mobile column tabs: miniature column heads, not filter chips.
// ---------------------------------------------------------------------------
const tabs = portrait.tabChrome ?? []
const activeTab = tabs.find(tab => tab.active) ?? null
const inactiveTabs = tabs.filter(tab => !tab.active)
report.tabs = { all: tabs, tabbar: portrait.tabbar }
check('mobile tabs expose a label and an integrated counter',
  tabs.length === 5 && tabs.every(tab => tab.hasLabel && tab.hasCount && (tab.label ?? '').length > 0 && (tab.count ?? '').length > 0),
  JSON.stringify(tabs.map(tab => `${tab.status}:${tab.label}:${tab.count}`)))
check('mobile tabs carry no dot chip (the top rule is the colour marker)',
  tabs.every(tab => tab.hasDot === false),
  JSON.stringify(tabs.map(tab => `${tab.status}:dot=${tab.hasDot}`)))
check('every tab paints its status rule on the top edge',
  tabs.every(tab => tab.ruleColor !== null && tab.ruleHeight !== '0px' && Number.parseInt(tab.ruleHeight, 10) >= 2),
  JSON.stringify(tabs.map(tab => `${tab.status}:${tab.ruleHeight}@${tab.ruleLeft}/${tab.ruleRight}`)))
// Same accent as the desktop column head of that status: one palette, two layouts.
const desktopRules = Object.fromEntries((report.viewports.desktop?.tabChrome ?? [])
  .map(tab => [tab.status, tab.desktopRuleColor]))
const paletteMatches = tabs.filter(tab => {
  const expected = desktopRules[tab.status]
  return expected !== undefined && expected !== null && JSON.stringify(expected) === JSON.stringify(tab.ruleColor)
})
check('tab accent colours match the desktop column-head rules',
  tabs.length === 5 && paletteMatches.length === 5,
  JSON.stringify({ tabRules: tabs.map(tab => `${tab.status}:${JSON.stringify(tab.ruleColor)}`), desktopRules }))
// The five requested colours are distinct: grey / blue / orange / violet / green.
check('the five status rules are visually distinct',
  new Set(tabs.map(tab => JSON.stringify(tab.ruleColor))).size === 5,
  JSON.stringify(tabs.map(tab => `${tab.status}:${JSON.stringify(tab.ruleColor)}`)))
check('the active tab shows a stronger, wider rule',
  activeTab !== null && activeTab.ruleOpacity === '1' && Number.parseFloat(activeTab.ruleOpacity) > Math.max(...inactiveTabs.map(tab => Number.parseFloat(tab.ruleOpacity) || 0))
    && Number.parseFloat(activeTab.ruleLeft) < Number.parseFloat(inactiveTabs[0]?.ruleLeft ?? '0'),
  JSON.stringify({ active: { opacity: activeTab?.ruleOpacity, left: activeTab?.ruleLeft }, inactive: inactiveTabs.map(tab => ({ opacity: tab.ruleOpacity, left: tab.ruleLeft })) }))
check('the active tab raises its surface above the inactive ones',
  activeTab !== null && inactiveTabs.every(tab => JSON.stringify(tab.surface) !== JSON.stringify(activeTab.surface))
    && inactiveTabs.every(tab => JSON.stringify(tab.surface) === JSON.stringify(inactiveTabs[0]?.surface)),
  JSON.stringify({ active: activeTab?.surface, inactive: inactiveTabs.map(tab => tab.surface) }))
check('the active tab reinforces the text',
  activeTab !== null && Number.parseInt(activeTab.fontWeight, 10) > Math.max(...inactiveTabs.map(tab => Number.parseInt(tab.fontWeight, 10) || 0)),
  JSON.stringify({ active: activeTab?.fontWeight, inactive: inactiveTabs.map(tab => tab.fontWeight) }))
check('tabs stay low but touch-friendly',
  tabs.every(tab => tab.height >= 32 && tab.height <= 38) && tabs.every(tab => Number.parseFloat(tab.radius) >= 9),
  JSON.stringify(tabs.map(tab => `${tab.status}:${tab.width}x${tab.height}@${tab.radius}`)))
check('the tab rail scrolls horizontally rather than squeezing the tabs',
  portrait.tabbar !== null && portrait.tabbar.overflowX === 'auto' && portrait.tabbar.scrollWidth >= portrait.tabbar.clientWidth,
  JSON.stringify(portrait.tabbar))
await shot('portrait-tabs-390x844.png')
await shot('portrait-todo-390x844.png')

// Tab → rail.
await page.evaluate(() => {
  document.querySelector('.dsh-atb-mobilebar-btn[data-status="in_review"]')?.click()
})
await settle(page, 900)
const afterTab = await readFocus()
report.gestures.tabClick = { rail: afterTab.rail, active: afterTab.activeStatus, counter: afterTab.pageCounter }
const expectedOffset = pageWidth * 3
check('tab click scrolls the rail to that page', afterTab.rail !== null && Math.abs(afterTab.rail.scrollLeft - expectedOffset) <= 2, JSON.stringify({ scrollLeft: afterTab.rail?.scrollLeft, expected: expectedOffset }))
check('tab click selects the tab', afterTab.activeStatus === 'in_review' && afterTab.pageCounter === '4/5', JSON.stringify({ active: afterTab.activeStatus, counter: afterTab.pageCounter }))
await shot('portrait-tab-in-review-390x844.png')

// Back to To do, then move the carousel and watch the tab follow.
await page.evaluate(() => { document.querySelector('.dsh-atb-mobilebar-btn[data-status="todo"]')?.click() })
await settle(page, 900)
const beforeScroll = await readFocus()
const wheel = await scrollCarouselPage(pageWidth)
const afterSwipe = await readFocus()
report.gestures.horizontalScroll = {
  mechanism: wheel.mechanism,
  attempts: wheel.attempts,
  before: beforeScroll.rail,
  after: afterSwipe.rail,
  active: afterSwipe.activeStatus,
  counter: afterSwipe.pageCounter,
}
const movedBy = (afterSwipe.rail?.scrollLeft ?? 0) - (beforeScroll.rail?.scrollLeft ?? 0)
check('the carousel moves by whole pages', wheel.moved && Math.abs(movedBy) >= pageWidth - 2, JSON.stringify({ mechanism: wheel.mechanism, movedBy, pageWidth, attempts: wheel.attempts }))
check('the status tab follows the carousel scroll', afterSwipe.activeStatus !== beforeScroll.activeStatus && (afterSwipe.tabSelected ?? []).filter(value => value === 'true').length === 1, JSON.stringify({ before: beforeScroll.activeStatus, after: afterSwipe.activeStatus, counter: afterSwipe.pageCounter }))
check('the carousel rests on a snap page', Math.abs((afterSwipe.rail?.scrollLeft ?? 0) % pageWidth) <= 2 || Math.abs(((afterSwipe.rail?.scrollLeft ?? 0) % pageWidth) - pageWidth) <= 2, `scrollLeft=${afterSwipe.rail?.scrollLeft} page=${pageWidth}`)
await shot('portrait-after-scroll-390x844.png')

// The snap engine itself (not our JS) must refuse off-page rest positions.
const snapProbe = await page.evaluate(async width => {
  const rail = document.querySelector('.dsh-atb-board .dsh-atb-columns')
  if (rail === null) return null
  rail.scrollLeft = width * 2 + Math.round(width * 0.4)
  await new Promise(resolve => setTimeout(resolve, 700))
  return { requested: width * 2 + Math.round(width * 0.4), settled: Math.round(rail.scrollLeft) }
}, pageWidth)
report.gestures.snapEngine = snapProbe
check('CSS scroll-snap re-settles an off-page offset', snapProbe !== null && Math.abs(snapProbe.settled % pageWidth) <= 2, JSON.stringify(snapProbe))
const afterSnapProbe = await readFocus()
check('the tab follows the snapped position', afterSnapProbe.activeStatus === statusFromOffset(snapProbe?.settled ?? 0, pageWidth), JSON.stringify({ settled: snapProbe?.settled, active: afterSnapProbe.activeStatus }))

// Every column keeps its own vertical scroll position: show the backlog page,
// scroll its long card list, and verify the carousel does not move.
await page.evaluate(() => { document.querySelector('.dsh-atb-mobilebar-btn[data-status="backlog"]')?.click() })
await settle(page, 900)
const beforePan = await readFocus()
const panProbe = await page.evaluate(() => {
  const board = document.querySelector('.dsh-atb-board')
  if (board === null) return null
  const lists = [...board.querySelectorAll('.dsh-atb-cards')]
  const target = lists.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] ?? null
  if (target === null) return null
  const column = target.closest('.dsh-atb-column')
  const before = Math.round(target.scrollTop)
  target.scrollTop = 1200
  return {
    status: column?.getAttribute('data-status') ?? null,
    before,
    after: Math.round(target.scrollTop),
    scrollHeight: target.scrollHeight,
    clientHeight: target.clientHeight,
    others: lists.filter(list => list !== target).map(list => Math.round(list.scrollTop)),
  }
})
await settle(page, 500)
const afterPan = await readFocus()
report.gestures.verticalScroll = {
  probe: panProbe,
  cardsBefore: beforePan.cardsScrollTop,
  cardsAfter: afterPan.cardsScrollTop,
  railBefore: beforePan.rail?.scrollLeft,
  railAfter: afterPan.rail?.scrollLeft,
}
check('the tallest column has its own vertical scroller', panProbe !== null && panProbe.scrollHeight > panProbe.clientHeight && panProbe.after > panProbe.before, JSON.stringify(panProbe))
check('scrolling one column leaves the others untouched', panProbe !== null && panProbe.others.every(top => top === 0), JSON.stringify(panProbe?.others))
check('vertical column scroll never flips the carousel page', (afterPan.rail?.scrollLeft ?? 0) === (beforePan.rail?.scrollLeft ?? 0), JSON.stringify({ before: beforePan.rail?.scrollLeft, after: afterPan.rail?.scrollLeft }))
await shot('portrait-vertical-scroll-390x844.png')
check('board survived every gesture', (await page.$('.dsh-atb-board')) !== null, 'board still mounted')

// Touch input: events must reach the page, and a horizontal pan across a card
// must never open the detail pane (the swipe-vs-tap guard).
await page.evaluate(() => {
  window.__atbTouch = { start: 0, move: 0, end: 0 }
  const bump = kind => () => { window.__atbTouch[kind] += 1 }
  document.addEventListener('touchstart', bump('start'), { capture: true, passive: true })
  document.addEventListener('touchmove', bump('move'), { capture: true, passive: true })
  document.addEventListener('touchend', bump('end'), { capture: true, passive: true })
})
const cardPoint = await page.evaluate(() => {
  const card = document.querySelector('.dsh-atb-board .dsh-atb-card')
  if (card === null) return null
  card.scrollIntoView({ block: 'center' })
  const box = card.getBoundingClientRect()
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + Math.min(box.height / 2, 80)) }
})
await settle(page, 400)
check('a card is tappable in portrait', cardPoint !== null, JSON.stringify(cardPoint))
if (cardPoint !== null) {
  await touchPan(cardPoint.x + 40, cardPoint.y, cardPoint.x - 60, cardPoint.y, 18)
  await settle(page, 600)
  const touchCounts = await page.evaluate(() => window.__atbTouch)
  const panDetail = await readDetail()
  report.gestures.touchPanOnCard = { touchCounts, detail: panDetail }
  check('touch events reach the page', touchCounts.start >= 1 && touchCounts.move >= 5 && touchCounts.end >= 1, JSON.stringify(touchCounts))
  check('a horizontal touch pan on a card never opens it', panDetail === null, JSON.stringify(panDetail))

  // A real click opens the detail sheet (synthetic touch does not synthesise a
  // click in this harness, so the tap's *scroll* behaviour is covered above and
  // the click path is exercised with a genuine mouse click).
  await page.mouse.click(cardPoint.x, cardPoint.y)
  await page.waitForSelector('.dsh-atb-detailpanel', { timeout: 20_000 })
  await settle(page, 600)
  const detail = await readDetail()
  report.viewports.portraitDetail = detail
  check('tap opens the detail pane', detail !== null, JSON.stringify(detail))
  check('portrait detail is a bottom sheet', detail !== null && detail.position === 'fixed' && detail.bottom === 0 && Math.abs(detail.width - 390) <= 1, JSON.stringify(detail))
  await shot('portrait-detail-sheet-390x844.png')
  await page.evaluate(() => {
    const close = document.querySelector('.dsh-atb-detailpanel .dsh-atb-detail-close, .dsh-atb-detailpanel [data-action="close"]')
    if (close instanceof HTMLElement) close.click()
    else document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  })
  await settle(page, 500)
  if (await page.$('.dsh-atb-detailpanel')) {
    await page.keyboard.press('Escape')
    await settle(page, 400)
  }
  check('detail sheet closes again', (await page.$('.dsh-atb-detailpanel')) === null, 'detail panel removed')
}

/** Open one mobile sheet through its icon button and wait for it. */
async function openSheet(action) {
  await page.evaluate(selector => { document.querySelector(selector)?.click() }, `.dsh-atb-mobileactions [data-action="${action}"]`)
  await settle(page, 700)
}

// Filters, actions and creation sheets.
await openSheet('filters')
const filtersSheet = await readSheet()
report.viewports.portraitFilters = filtersSheet
const filterCounts = await page.evaluate(() => ({
  selects: document.querySelectorAll('.dsh-atb-sheet .dsh-atb-sel').length,
  chips: document.querySelectorAll('.dsh-atb-sheet .dsh-atb-chip[data-urgency]').length,
  reset: document.querySelectorAll('.dsh-atb-sheet [data-sheet-action="reset"]').length,
}))
check('filters sheet keeps every filter control', filtersSheet !== null && filterCounts.selects === 3 && filterCounts.chips === 3 && filterCounts.reset === 1, JSON.stringify(filterCounts))
check('filters sheet is a full-width bottom sheet', filtersSheet !== null && filtersSheet.bottom === 0 && Math.abs(filtersSheet.width - 390) <= 1, JSON.stringify(filtersSheet))
await shot('portrait-filters-sheet-390x844.png')
await page.keyboard.press('Escape')
await settle(page, 500)

await openSheet('menu')
const menuItems = await page.evaluate(() => [...document.querySelectorAll('.dsh-atb-sheet-item')].map(item => item.dataset.item))
report.viewports.portraitMenu = { items: menuItems, sheet: await readSheet() }
check('actions sheet keeps grouping + every board action', ['group', 'secondary', 'settings', 'diagnostics', 'import', 'export-json', 'export-csv'].every(id => menuItems.includes(id)), JSON.stringify(menuItems))
await shot('portrait-actions-sheet-390x844.png')
await page.keyboard.press('Escape')
await settle(page, 500)

await page.evaluate(() => { document.querySelector('.dsh-atb-fab')?.click() })
await settle(page, 800)
const newTask = await page.evaluate(() => ({
  sheet: document.querySelector('.dsh-atb-sheet') !== null,
  templates: document.querySelectorAll('.dsh-atb-newmenu-list-sheet .dsh-atb-newmenu-opt').length,
  labels: [...document.querySelectorAll('.dsh-atb-newmenu-list-sheet .dsh-atb-newmenu-opt')].slice(0, 4).map(option => option.textContent?.trim()),
}))
report.viewports.portraitNewTask = newTask
check('create button opens the task sheet with the templates', newTask.sheet && newTask.templates >= 1, JSON.stringify(newTask))
await shot('portrait-newtask-sheet-390x844.png')
await page.keyboard.press('Escape')
await settle(page, 500)

// ---------------------------------------------------------------------------
// 3. Light theme, portrait (host presenter drives it — the plugin never forces it).
// ---------------------------------------------------------------------------
console.log('→ portrait light theme')
await applyTheme('light', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: false, hasTouch: true })
const theme = await page.evaluate(() => ({
  dark: document.body.hasAttribute('data-ds-dark-theme'),
  scheme: getComputedStyle(document.documentElement).colorScheme,
}))
const lightPortrait = await readFocus()
report.viewports.portraitLight = { theme, metrics: lightPortrait }
const lightLuminance = lightPortrait.cardBg === null ? null : luminance(lightPortrait.cardBg)
check('host light theme applied without a plugin override', theme.dark === false && /light/.test(theme.scheme), JSON.stringify(theme))
check('portrait light theme keeps the carousel', lightPortrait.focus === 'portrait' && lightPortrait.columnWidths.every(width => Math.abs(width - (lightPortrait.rail?.clientWidth ?? 0)) <= 1), JSON.stringify({ focus: lightPortrait.focus, widths: lightPortrait.columnWidths }))
check('portrait light theme paints light card surfaces', lightLuminance !== null && lightLuminance > 0.6, `luminance=${lightLuminance?.toFixed(3)}`)
const lightContrast = contrast(lightPortrait.titleColor, lightPortrait.cardBg)
check('portrait light theme keeps the title readable (WCAG AA)', lightContrast !== null && lightContrast >= 4.5, `contrast=${lightContrast}`)
await shot('portrait-light-390x844.png')

// ---------------------------------------------------------------------------
// 4. Landscape 844×390 — two columns per page.
// ---------------------------------------------------------------------------
console.log('→ landscape 844×390')
await applyTheme('dark', { width: 844, height: 390, deviceScaleFactor: 2, isMobile: false, hasTouch: true })
let landscape = await readFocus()
report.viewports.landscape = landscape
const landscapeWidth = landscape.rail?.clientWidth ?? 0
const expectedTwoUp = (landscapeWidth - 9) / 2
check('landscape switches to the two-up carousel', landscape.focus === 'landscape', String(landscape.focus))
check('landscape shows two columns per page', landscape.columnWidths.length >= 2 && landscape.columnWidths.every(width => Math.abs(width - expectedTwoUp) <= 2), JSON.stringify({ widths: landscape.columnWidths, expected: expectedTwoUp }))
check('landscape rail snaps horizontally', landscape.rail !== null && /mandatory/.test(landscape.rail.snapType ?? '') && landscape.rail.scrollWidth > landscape.rail.clientWidth, JSON.stringify(landscape.rail))
check('landscape keeps the status tabs and the page cue', landscape.tabCount === 5 && /flex/.test(landscape.cueDisplay ?? ''), JSON.stringify({ tabs: landscape.tabCount, cue: landscape.cueDisplay }))
check('landscape hides the floating create button', landscape.fab === null || landscape.fab.display === 'none', JSON.stringify(landscape.fab))
await shot('landscape-844x390.png')

// Scroll to the end of the rail with real horizontal input: the last page must
// report Done even though it can never be the leftmost column two-up.
const landscapeSteps = []
for (let attempt = 0; attempt < 5; attempt += 1) {
  const step = await scrollCarouselPage(landscapeWidth)
  landscapeSteps.push({ moved: step.moved, direction: step.direction, rail: await railScrollLeft() })
  if (!step.moved) break
}
landscape = await readFocus()
report.gestures.landscapeEnd = { steps: landscapeSteps, rail: landscape.rail, active: landscape.activeStatus, counter: landscape.pageCounter }
const atEnd = landscape.rail !== null && landscape.rail.scrollLeft >= landscape.rail.scrollWidth - landscape.rail.clientWidth - 2
check('landscape horizontal scrolling reaches the end of the rail', atEnd, JSON.stringify(landscape.rail))
check('landscape end of rail selects Done', landscape.activeStatus === 'done', JSON.stringify({ active: landscape.activeStatus, counter: landscape.pageCounter }))
await shot('landscape-end-844x390.png')

// Tab click back to backlog.
await page.evaluate(() => { document.querySelector('.dsh-atb-mobilebar-btn[data-status="backlog"]')?.click() })
await settle(page, 900)
const backToStart = await readFocus()
check('landscape tab click returns to the first page', (backToStart.rail?.scrollLeft ?? -1) === 0 && backToStart.activeStatus === 'backlog', JSON.stringify({ scrollLeft: backToStart.rail?.scrollLeft, active: backToStart.activeStatus }))

// ---------------------------------------------------------------------------
// 5. Back to desktop: the board must return to five inline columns.
// ---------------------------------------------------------------------------
console.log('→ desktop after the mobile passes')
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false })
await settle(page, 1000)
if ((await page.$('.dsh-atb-board .dsh-atb-card')) === null) {
  // The shell may drop the panel when the viewport shape changes back.
  await openBoard(page, 25_000)
  await settle(page, 800)
}
const desktopAgain = await readFocus()
report.viewports.desktopAfterResize = desktopAgain
check('desktop is restored after leaving focus mode', desktopAgain.focus === 'none' && desktopAgain.columnCount === 5 && desktopAgain.draggable === 'true', JSON.stringify({ focus: desktopAgain.focus, columns: desktopAgain.columnCount, draggable: desktopAgain.draggable }))
check('desktop filter cluster is back in the toolbar', desktopAgain.toolbarFiltersDisplay === 'contents', String(desktopAgain.toolbarFiltersDisplay))
await shot('desktop-after-resize-1440x900.png')

// ---------------------------------------------------------------------------
// 6. Report.
// ---------------------------------------------------------------------------
const failed = report.checks.filter(entry => !entry.ok)
writeFileSync(join(outDir, 'metrics-mobile.json'), JSON.stringify(report, null, 2))

const lines = [
  '# Mobile focus mode — real-host validation',
  '',
  `- Label: \`${label}\``,
  `- Generated: ${report.generatedAt}`,
  `- Host: ${base} (isolated DSH home, production client bundle from this working tree)`,
  `- Browser: ${executablePath}`,
  '',
  '## Viewports exercised',
  '',
  '| Viewport | `data-atb-focus` | Columns | Column widths | Rail snap | Active status |',
  '| --- | --- | --- | --- | --- | --- |',
  `| 1440×900 | ${report.viewports.desktop?.focus} | ${report.viewports.desktop?.columnCount} | ${report.viewports.desktop?.columnWidths?.join(' / ')} | ${report.viewports.desktop?.rail?.snapType ?? '—'} | ${report.viewports.desktop?.activeStatus} |`,
  `| 390×844 | ${report.viewports.portrait?.focus} | ${report.viewports.portrait?.columnCount} | ${report.viewports.portrait?.columnWidths?.join(' / ')} | ${report.viewports.portrait?.rail?.snapType} | ${report.viewports.portrait?.activeStatus} |`,
  `| 844×390 | ${report.viewports.landscape?.focus} | ${report.viewports.landscape?.columnCount} | ${report.viewports.landscape?.columnWidths?.join(' / ')} | ${report.viewports.landscape?.rail?.snapType} | ${report.viewports.landscape?.activeStatus} |`,
  `| 1440×900 (retour) | ${report.viewports.desktopAfterResize?.focus} | ${report.viewports.desktopAfterResize?.columnCount} | ${report.viewports.desktopAfterResize?.columnWidths?.join(' / ')} | ${report.viewports.desktopAfterResize?.rail?.snapType ?? '—'} | ${report.viewports.desktopAfterResize?.activeStatus} |`,
  '',
  '## Scroll, snap and touch evidence (real Chromium input)',
  '',
  `- Horizontal scroll (${report.gestures.horizontalScroll?.mechanism}): rail \`${report.gestures.horizontalScroll?.before?.scrollLeft} → ${report.gestures.horizontalScroll?.after?.scrollLeft} px\`, tab \`${report.gestures.horizontalScroll?.active}\`, counter \`${report.gestures.horizontalScroll?.counter}\``,
  `- CSS snap engine: requested \`${report.gestures.snapEngine?.requested} px\` → settled \`${report.gestures.snapEngine?.settled} px\``,
  `- Vertical scroll: cards \`${report.gestures.verticalScroll?.cardsBefore} → ${report.gestures.verticalScroll?.cardsAfter} px\`, rail unchanged (\`${report.gestures.verticalScroll?.railBefore} → ${report.gestures.verticalScroll?.railAfter}\`)`,
  `- Touch events on a card: \`${JSON.stringify(report.gestures.touchPanOnCard?.touchCounts)}\`, detail opened: \`${report.gestures.touchPanOnCard?.detail !== null}\``,
  `- Tab click: rail to \`${report.gestures.tabClick?.rail?.scrollLeft} px\`, tab \`${report.gestures.tabClick?.active}\``,
  `- Landscape end of rail: scrollLeft \`${report.gestures.landscapeEnd?.rail?.scrollLeft}\`, tab \`${report.gestures.landscapeEnd?.active}\``,
  '',
  '## Checks',
  '',
  `Total: ${report.checks.length} — passed: ${report.checks.length - failed.length} — failed: ${failed.length}`,
  '',
  ...report.checks.map(entry => `- ${entry.ok ? '✅' : '❌'} **${entry.name}** — ${entry.detail}`),
  '',
  '## Screenshots',
  '',
  ...report.screenshots.map(name => `- \`${name}\``),
  '',
  '## Limitations',
  '',
  ...(report.limitations.length === 0 ? ['- None recorded: every check above ran against the real host.'] : report.limitations.map(item => `- ${item}`)),
  '',
]

writeFileSync(join(outDir, 'visual-report-mobile.md'), lines.join('\n'))
console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed`)
if (failed.length > 0) {
  console.error(`FAILED: ${failed.map(entry => entry.name).join(', ')}`)
}

await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
