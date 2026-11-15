/**
 * Desktop header compaction — real-DSH geometry capture.
 *
 * Driven by `scripts/qa/pastel-visual-host.ps1 -CaptureScript desktop-header-capture.mjs`,
 * which boots an isolated real DSH host, links this working tree, seeds a dense
 * board and passes PTB_BASE / PTB_TOKEN / PTB_OUT / PTB_BROWSER / PTB_LABEL.
 *
 * The question this script answers with numbers (never with an opinion):
 * how many visual rows do the board head (`.dsh-atb-head`) and the toolbar
 * (`.dsh-atb-toolbar`) occupy at real desktop panel widths, which item lands on
 * which row, and does the toolbar overflow horizontally once it is not allowed
 * to wrap? Every child is measured through `display: contents` wrappers, so the
 * two desktop clusters are counted as the direct flex items they really are.
 *
 * Screenshots + metrics-desktop-header.json + visual-report-desktop.md land in
 * PTB_OUT. A check that cannot be proven is recorded as a failure.
 *
 * @module dsh-taskboard/scripts/qa/desktop-header-capture
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

/** Viewports probed, widest first (a 1920 desktop, a 1512 laptop, a split view). */
const VIEWPORTS = [
  { name: '1920x900', width: 1920, height: 900 },
  { name: '1680x900', width: 1680, height: 900 },
  { name: '1512x900', width: 1512, height: 900 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x860', width: 1280, height: 860 },
  { name: '1120x860', width: 1120, height: 860 },
]

const report = {
  label,
  generatedAt: new Date().toISOString(),
  base,
  browser: executablePath,
  screenshots: [],
  checks: [],
  viewports: {},
}

/** Record one pass/fail check and echo it. */
function check(name, ok, detail) {
  report.checks.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`)
  flush()
}

/** Persist evidence after every check (a later crash must not lose it). */
function flush() {
  writeFileSync(join(outDir, 'metrics-desktop-header.json'), JSON.stringify(report, null, 2))
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  protocolTimeout: 180_000,
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb', '--lang=fr-FR', '--disable-extensions'],
  defaultViewport: { width: 1920, height: 900, deviceScaleFactor: 1 },
})

const page = await browser.newPage()
page.on('pageerror', error => console.log('pageerror:', String(error)))
// Real cookie handshake, exactly like the phone capture script.
await page.goto(`${base}/?token=${token}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })

/** Dismiss the shell's first-run dialogs with real mouse clicks. */
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
    const target = state.buttons.find(button => /continuer|continue|commencer|start|ignorer|skip/i.test(button.text))
      ?? state.buttons.find(button => button.width <= 44)
      ?? state.buttons.find(button => button.text.length === 0)
    if (target === undefined) {
      // No clickable dismissal (e.g. the sign-in wall): Escape is the shell's
      // own close gesture and costs nothing if the dialog ignores it.
      steps.push({ text: '<Escape>', x: 0, y: 0 })
      await page.keyboard.press('Escape')
      await sleep(700)
      const stillOpen = await page.evaluate(() => [...document.querySelectorAll('[class*="_dialog_"]')]
        .some(dialog => dialog.getBoundingClientRect().width > 0))
      if (!stillOpen) return { dismissed: true, steps }
      return { dismissed: false, steps }
    }
    steps.push({ text: target.text, x: target.x, y: target.y })
    await page.mouse.click(target.x, target.y)
    await sleep(900)
  }
  return { dismissed: false, steps }
}

/** Let layout and transitions settle. */
async function settle(ms = 700) {
  await sleep(ms)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/** Open the board panel inside the real shell (accepts an already-open panel). */
async function openBoard(budgetMs = 45_000) {
  await page.waitForFunction(
    () => document.querySelector('.dsh-atb-board .dsh-atb-card') !== null
      || document.querySelector('button .dsh-atb-pglyph') !== null
      || document.querySelector('[class*="_dialog_"]') !== null,
    { timeout: budgetMs },
  )
  if ((await page.$('[class*="_dialog_"]')) !== null) {
    report.shellOverlays = await dismissHostOverlays()
    await settle(600)
  }
  if ((await page.$('.dsh-atb-board .dsh-atb-card')) === null) {
    await page.waitForFunction(() => document.querySelector('button .dsh-atb-pglyph') !== null, { timeout: budgetMs })
    await page.evaluate(() => document.querySelector('.dsh-atb-pglyph')?.closest('button')?.click())
  }
  await page.waitForSelector('.dsh-atb-board .dsh-atb-card', { timeout: budgetMs })
  await settle(900)
}

/** Screenshot helper that records the file name. */
async function shot(name) {
  await page.screenshot({ path: join(outDir, name) })
  report.screenshots.push(name)
}

/**
 * Read the head/toolbar layout in one round trip.
 *
 * Row grouping uses the rounded `top` of each *real* flex item: `display: contents`
 * wrappers are recursed into so the filter/action clusters are not counted as a
 * single box (which is exactly how the browser lays them out).
 */
async function readHeader() {
  return page.evaluate(() => {
    const board = document.querySelector('.dsh-atb-board')
    if (board === null) return { board: false }
    const describe = el => {
      const box = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return {
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).replace(/\s+/g, '.').slice(0, 60),
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 28),
        aria: el.getAttribute('aria-label'),
        x: Math.round(box.x),
        y: Math.round(box.y),
        top: Math.round(box.top),
        width: Math.round(box.width),
        height: Math.round(box.height),
        display: style.display,
      }
    }
    /** Flatten `display: contents` wrappers into their visible children. */
    const flatten = (root, depth = 0) => {
      const out = []
      for (const child of [...root.children]) {
        const style = getComputedStyle(child)
        if (style.display === 'none') continue
        if (style.display === 'contents' && depth < 4) out.push(...flatten(child, depth + 1))
        else out.push(child)
      }
      return out
    }
    const rowsOf = items => {
      // Row grouping by vertical centre: flex items of different heights are
      // centred on the same line, so their tops differ and their centres agree.
      // Zero-size items (spacers) are ignored: they belong to no line.
      const visible = items.filter(entry => entry.width > 0 && entry.height > 0)
      const sorted = [...visible].sort((a, b) => (a.top + a.height / 2) - (b.top + b.height / 2))
      const rows = []
      for (const item of sorted) {
        const center = item.top + item.height / 2
        const row = rows.find(candidate => Math.abs(candidate.center - center) <= 8)
        if (row === undefined) rows.push({ center, top: item.top, items: [item] })
        else row.items.push(item)
      }
      return rows.sort((a, b) => a.center - b.center)
    }
    const head = board.querySelector('.dsh-atb-head')
    const toolbar = board.querySelector('.dsh-atb-toolbar')
    const headItems = head === null ? [] : flatten(head).map(describe)
    const toolbarItems = toolbar === null ? [] : flatten(toolbar).map(describe)
    const rows = item => rowsOf(item).map(row => ({
      top: row.top,
      height: Math.max(...row.items.map(entry => entry.height)),
      items: row.items.map(entry => ({
        cls: entry.cls,
        text: entry.text,
        aria: entry.aria,
        x: entry.x,
        width: entry.width,
      })),
    }))
    const searchfield = toolbar?.querySelector('.dsh-atb-searchfield')
    // The action cluster lives on the title row; look it up from the board.
    const settingsBtn = board.querySelector('[data-action="appearance"]')
    const settingsIcon = settingsBtn?.querySelector('svg')
    const iconBox = settingsIcon === null || settingsIcon === undefined ? null : settingsIcon.getBoundingClientRect()
    return {
      board: true,
      focus: board.getAttribute('data-atb-focus'),
      bar: board.getAttribute('data-atb-bar'),
      boardWidth: Math.round(board.getBoundingClientRect().width),
      boardRect: describe(board),
      headRows: rows(headItems),
      toolbarRows: rows(toolbarItems),
      headRowCount: rows(headItems).length,
      toolbarRowCount: rows(toolbarItems).length,
      toolbar: toolbar === null ? null : {
        display: getComputedStyle(toolbar).display,
        flexWrap: getComputedStyle(toolbar).flexWrap,
        gap: getComputedStyle(toolbar).gap,
        clientWidth: toolbar.clientWidth,
        scrollWidth: toolbar.scrollWidth,
        height: Math.round(toolbar.getBoundingClientRect().height),
      },
      searchfield: searchfield === null || searchfield === undefined ? null : {
        width: Math.round(searchfield.getBoundingClientRect().width),
        flex: getComputedStyle(searchfield).flex,
      },
      settings: settingsBtn === null || settingsBtn === undefined ? null : {
        width: Math.round(settingsBtn.getBoundingClientRect().width),
        height: Math.round(settingsBtn.getBoundingClientRect().height),
        label: (settingsBtn.textContent ?? '').trim(),
        ariaLabel: settingsBtn.getAttribute('aria-label'),
        title: settingsBtn.getAttribute('title'),
        hasIcon: settingsIcon !== null && settingsIcon !== undefined,
        iconSize: iconBox === null ? null : { width: Math.round(iconBox.width), height: Math.round(iconBox.height) },
        iconMarkup: settingsIcon === null || settingsIcon === undefined ? null : settingsIcon.innerHTML,
      },
      // Proof that the compaction is *rendered*, not just flagged on the root.
      actionsInHead: head === null ? false : head.querySelector('.dsh-atb-toolbar-actions') !== null,
      actionsInToolbar: toolbar === null ? false : toolbar.querySelector('.dsh-atb-toolbar-actions') !== null,
      actionLabelDisplay: (() => {
        const label = board.querySelector('[data-action="appearance"] .dsh-atb-btn-label')
        return label === null ? null : getComputedStyle(label).display
      })(),
      chipLabelDisplay: (() => {
        const label = board.querySelector('.dsh-atb-toolbar .dsh-atb-chip .dsh-atb-chip-label')
        return label === null ? null : getComputedStyle(label).display
      })(),
      headRect: head === null ? null : {
        width: Math.round(head.getBoundingClientRect().width),
        height: Math.round(head.getBoundingClientRect().height),
      },
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
}

await openBoard()

for (const viewport of VIEWPORTS) {
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 })
  await settle(700)
  const header = await readHeader()
  if (header.board !== true) {
    check(`${viewport.name} board present`, false, 'no .dsh-atb-board in the shell')
    continue
  }
  report.viewports[viewport.name] = header
  const names = row => row.items.map(item => item.aria ?? item.text ?? item.cls).join(' | ')
  console.log(`\n== ${viewport.name} — board ${header.boardWidth}px`)
  header.headRows.forEach((row, index) => console.log(`  head row ${index + 1}: ${names(row)}`))
  header.toolbarRows.forEach((row, index) => console.log(`  toolbar row ${index + 1}: ${names(row)}`))
  flush()
  if (viewport.name === '1440x900' || viewport.name === '1280x860' || viewport.name === '1920x900') {
    await shot(`desktop-${viewport.width}.png`)
  }
}

// ---------------------------------------------------------------------------
// Verdicts. The acceptance target the user asked for: at every probed desktop
// width the whole header (head + toolbar) must fit in at most two visual rows.
// ---------------------------------------------------------------------------
for (const viewport of VIEWPORTS) {
  const header = report.viewports[viewport.name]
  if (header === undefined) continue
  const total = header.headRowCount + header.toolbarRowCount
  check(
    `${viewport.name} header rows ≤ 2`,
    total <= 2,
    `head=${header.headRowCount} toolbar=${header.toolbarRowCount} total=${total} (board ${header.boardWidth}px)`,
  )
  check(
    `${viewport.name} toolbar does not overflow`,
    header.toolbar === null ? false : header.toolbar.scrollWidth <= header.toolbar.clientWidth + 1,
    header.toolbar === null ? 'no toolbar' : `scrollWidth=${header.toolbar.scrollWidth} clientWidth=${header.toolbar.clientWidth}`,
  )
  check(
    `${viewport.name} no page horizontal overflow`,
    header.overflowX <= 0,
    `overflowX=${header.overflowX}`,
  )
  // The action cluster must be on the title row, never on the filter row.
  check(
    `${viewport.name} actions live on the title row`,
    header.actionsInHead === true && header.actionsInToolbar === false,
    `inHead=${header.actionsInHead} inToolbar=${header.actionsInToolbar}`,
  )
  // Rendered compaction: the labels really disappear once the words stop
  // fitting, and the chips only lose theirs in the densest state.
  if (header.bar === 'wide') {
    check(`${viewport.name} keeps every label`, header.actionLabelDisplay !== 'none' && header.chipLabelDisplay !== 'none',
      `action=${header.actionLabelDisplay} chip=${header.chipLabelDisplay}`)
  } else if (header.bar === 'compact') {
    check(`${viewport.name} drops action words, keeps chip words`,
      header.actionLabelDisplay === 'none' && header.chipLabelDisplay !== 'none',
      `action=${header.actionLabelDisplay} chip=${header.chipLabelDisplay}`)
  } else {
    check(`${viewport.name} drops action and chip words`,
      header.actionLabelDisplay === 'none' && header.chipLabelDisplay === 'none',
      `action=${header.actionLabelDisplay} chip=${header.chipLabelDisplay}`)
  }
}

const desktop = report.viewports['1440x900']
if (desktop !== undefined) {
  check(
    'settings action is a real gear/sliders glyph with a name',
    desktop.settings !== null
      && desktop.settings.hasIcon
      && desktop.settings.iconSize !== null
      && desktop.settings.iconSize.width >= 12
      && (desktop.settings.ariaLabel ?? '').length > 0
      && desktop.settings.title !== null,
    JSON.stringify({ size: desktop.settings?.iconSize, aria: desktop.settings?.ariaLabel, label: desktop.settings?.label }),
  )
  report.settingsIconMarkup = desktop.settings?.iconMarkup ?? null
}

flush()
writeFileSync(
  join(outDir, 'visual-report-desktop.md'),
  [
    `# Desktop header compaction — ${label}`,
    '',
    `- Generated: ${report.generatedAt}`,
    `- Host: ${base}`,
    `- Browser: ${executablePath}`,
    '',
    '## Rows per width',
    '',
    '| Viewport | Board | Head rows | Toolbar rows | Total | Toolbar overflow |',
    '|---|---|---|---|---|---|',
    ...Object.entries(report.viewports).map(([name, header]) => {
      const wrapped = header.toolbar === null ? '—' : `${header.toolbar.scrollWidth - header.toolbar.clientWidth}px`
      return `| ${name} | ${header.boardWidth}px | ${header.headRowCount} | ${header.toolbarRowCount} | ${header.headRowCount + header.toolbarRowCount} | ${wrapped} |`
    }),
    '',
    '## Checks',
    '',
    ...report.checks.map(entry => `- ${entry.ok ? 'PASS' : 'FAIL'} — ${entry.name}: ${entry.detail}`),
    '',
    '## Screenshots',
    '',
    ...report.screenshots.map(name => `- \`${name}\``),
    '',
  ].join('\n'),
)

const failed = report.checks.filter(entry => !entry.ok).length
console.log(`\n${report.checks.length - failed}/${report.checks.length} checks passed`)
await browser.close()
process.exit(failed === 0 ? 0 : 1)
