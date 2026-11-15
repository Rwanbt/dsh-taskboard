/**
 * Detail-sheet audit (temporary): measure the acceptance checklist inside the
 * mobile detail drawer on a real DSH host.
 *
 * Driven by `scripts/qa/pastel-visual-host.ps1 -CaptureScript detail-audit.mjs`
 * (or run directly against a kept host with the PTB_* env vars).
 *
 * @module dsh-taskboard/scripts/qa/detail-audit
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const base = process.env.PTB_BASE
const token = process.env.PTB_TOKEN
const outDir = process.env.PTB_OUT
const executablePath = process.env.PTB_BROWSER
if (!base || !token || !outDir || !executablePath) {
  console.error('missing PTB_*')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  protocolTimeout: 120_000,
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb', '--lang=fr-FR'],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
})
const page = await browser.newPage()
page.on('pageerror', e => console.log('pageerror:', String(e)))
await page.goto(`${base}/?token=${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => document.querySelector('.dsh-atb-board .dsh-atb-card') !== null
  || document.querySelector('button .dsh-atb-pglyph') !== null
  || document.querySelector('[class*="_dialog_"], [class*="_mask_"]') !== null, { timeout: 60_000 })

/** Click through every shell overlay that covers the panel (real mouse clicks). */
async function dismissOverlays() {
  const steps = []
  for (let step = 0; step < 10; step += 1) {
    const state = await page.evaluate(() => {
      // Any full-viewport fixed layer that swallows pointer events is an overlay,
      // whatever its CSS-module name is (the sign-in wall is `_root_…`, not
      // `_dialog_…`).
      const overlays = [...document.querySelectorAll('div, section, aside')].filter(el => {
        const style = getComputedStyle(el)
        if (style.position !== 'fixed' || style.pointerEvents === 'none' || style.display === 'none') return false
        const box = el.getBoundingClientRect()
        return box.width >= window.innerWidth - 2 && box.height >= window.innerHeight * 0.7
      })
      const buttons = overlays.flatMap(overlay => [...overlay.querySelectorAll('button')]).map(button => {
        const box = button.getBoundingClientRect()
        return {
          text: (button.textContent ?? '').trim().slice(0, 40),
          x: Math.round(box.x + box.width / 2),
          y: Math.round(box.y + box.height / 2),
          width: Math.round(box.width),
          visible: box.width > 0 && box.height > 0,
        }
      }).filter(button => button.visible)
      return { overlays: overlays.length, classes: overlays.slice(0, 3).map(el => String(el.className).slice(0, 40)), buttons }
    })
    if (state.overlays === 0) return { dismissed: true, steps }
    const target = state.buttons.find(b => /continue|continuer|compris|fermer|close|d'accord|ignorer|skip|plus tard|later/i.test(b.text))
      ?? state.buttons.find(b => b.width <= 44 && b.text.length === 0)
      ?? state.buttons.find(b => b.width <= 44)
    if (target === undefined) {
      await page.keyboard.press('Escape')
      await sleep(600)
      const left = await page.evaluate(() => [...document.querySelectorAll('div, section, aside')].filter(el => {
        const style = getComputedStyle(el)
        if (style.position !== 'fixed' || style.pointerEvents === 'none' || style.display === 'none') return false
        const box = el.getBoundingClientRect()
        return box.width >= window.innerWidth - 2 && box.height >= window.innerHeight * 0.7
      }).length)
      if (left === 0) return { dismissed: true, steps }
      return { dismissed: false, steps, remaining: state.classes }
    }
    steps.push({ text: target.text, x: target.x, y: target.y })
    await page.mouse.click(target.x, target.y)
    await sleep(900)
  }
  return { dismissed: false, steps }
}

// The shell can mount its sign-in wall a few seconds after the first paint, so
// the overlays are dismissed twice with a reachability probe in between.
await sleep(3000)
let overlays = await dismissOverlays()
await sleep(1500)
overlays = await dismissOverlays()
console.log('overlays:', JSON.stringify(overlays))
if ((await page.$('.dsh-atb-board')) === null) {
  await page.evaluate(() => document.querySelector('.dsh-atb-pglyph')?.closest('button')?.click())
  await page.waitForSelector('.dsh-atb-board .dsh-atb-card', { timeout: 45_000 })
}
await sleep(1200)
const reachableNow = await page.evaluate(() => {
  const card = document.querySelector('.dsh-atb-card')
  if (card === null) return { reachable: false, reason: 'no card' }
  const box = card.getBoundingClientRect()
  const hit = document.elementFromPoint(Math.round(box.x + box.width / 2), Math.round(box.y + 20))
  return { reachable: hit !== null && hit.closest('.dsh-atb-board') !== null, hit: hit === null ? null : `${hit.tagName}.${String(hit.className).slice(0, 30)}` }
})
console.log('reachable:', JSON.stringify(reachableNow))

// Open the "In review" page.
await page.evaluate(() => document.querySelector('.dsh-atb-mobilebar-btn[data-status="in_review"]')?.click())
await sleep(1000)

/** Pick a card that really carries checklist items, wherever it lives. */
const cardPoint = await page.evaluate(() => {
  const board = document.querySelector('.dsh-atb-board')
  if (board === null) return { error: 'no board' }
  const cards = [...board.querySelectorAll('.dsh-atb-card')]
  const target = cards.find(card => (card.querySelector('.dsh-atb-card-title')?.textContent ?? '').includes('Contrôle checklist'))
  const withChecklist = cards.find(card => card.querySelector('[data-kind="checklist"]') !== null)
  const card = target ?? withChecklist ?? cards[0]
  if (card === undefined) return { error: 'no card', cards: cards.length }
  const status = card.closest('.dsh-atb-column')?.getAttribute('data-status') ?? null
  // Bring the whole checklist card row into view first.
  card.scrollIntoView({ block: 'center' })
  const box = card.getBoundingClientRect()
  const x = Math.round(box.x + box.width / 2)
  const y = Math.round(box.y + 30)
  const hit = document.elementFromPoint(x, y)
  return {
    cards: cards.length,
    picked: target !== undefined ? 'target-task' : withChecklist !== undefined ? 'with-checklist' : 'first',
    status,
    title: (card.querySelector('.dsh-atb-card-title')?.textContent ?? '').slice(0, 50),
    badge: (card.querySelector('[data-kind="checklist"]')?.textContent ?? '').slice(0, 20),
    x, y,
    hit: hit === null ? null : `${hit.tagName}.${String(hit.className).slice(0, 30)}`,
    reachable: hit !== null && hit.closest('.dsh-atb-board') !== null,
  }
})
console.log('card:', JSON.stringify(cardPoint))
// Make sure the column holding that card is the carousel page in view.
if (cardPoint.status !== null && cardPoint.status !== undefined) {
  await page.evaluate(status => document.querySelector(`.dsh-atb-mobilebar-btn[data-status="${status}"]`)?.click(), cardPoint.status)
  await sleep(1000)
}

/**
 * Open candidate cards until one shows a checklist block in the drawer.
 * A click can miss (overlay, animation, wrong card) so the audit never assumes
 * the first attempt worked: it verifies what the drawer actually contains.
 */
async function openChecklistDrawer() {
  const candidates = await page.evaluate(() => {
    const board = document.querySelector('.dsh-atb-board')
    return [...(board?.querySelectorAll('.dsh-atb-card') ?? [])].map((card, index) => {
      const box = card.getBoundingClientRect()
      return {
        index,
        title: (card.querySelector('.dsh-atb-card-title')?.textContent ?? '').slice(0, 60),
        checklist: card.querySelector('[data-kind="checklist"]') !== null,
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + Math.min(30, Math.max(12, box.height / 2))),
      }
    })
  })
  const ranked = [
    ...candidates.filter(c => /contr[oô]le checklist/i.test(c.title)),
    ...candidates.filter(c => c.checklist && !/contr[oô]le checklist/i.test(c.title)),
    ...candidates.filter(c => !c.checklist),
  ].slice(0, 10)
  for (const candidate of ranked) {
    await page.evaluate(() => {
      const close = document.querySelector('.dsh-atb-detail-close')
      if (close !== null) close.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    })
    await sleep(400)
    await page.mouse.click(candidate.x, candidate.y)
    await sleep(1200)
    let check = await page.evaluate(() => {
      const panel = document.querySelector('.dsh-atb-detailpanel')
      const heading = panel?.querySelector('.dsh-atb-detail-titlebar h3')?.textContent ?? null
      return { open: panel !== null, heading: heading?.slice(0, 60) ?? null, hasChecklist: panel?.querySelector('.dsh-atb-fieldcard[data-kind="checklist"]') !== null }
    })
    if (!check.open) {
      // Fall back to a synthetic click on that very card.
      await page.evaluate(title => {
        const card = [...document.querySelectorAll('.dsh-atb-card')]
          .find(el => (el.querySelector('.dsh-atb-card-title')?.textContent ?? '').slice(0, 60) === title)
        card?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      }, candidate.title)
      await sleep(1200)
      check = await page.evaluate(() => {
        const panel = document.querySelector('.dsh-atb-detailpanel')
        return {
          open: panel !== null,
          heading: panel?.querySelector('.dsh-atb-detail-titlebar h3')?.textContent?.slice(0, 60) ?? null,
          hasChecklist: panel?.querySelector('.dsh-atb-fieldcard[data-kind="checklist"]') !== null,
        }
      })
    }
    console.log('try', candidate.index, JSON.stringify(candidate.title), '→', JSON.stringify(check))
    if (check.open && check.hasChecklist) return { candidate, check }
  }
  return null
}

const opened = await openChecklistDrawer()
console.log('opened:', JSON.stringify(opened))
const drawerOpen = (await page.$('.dsh-atb-detailpanel')) !== null
if (!drawerOpen) console.log('no detail panel at all')


const measure = () => page.evaluate(() => {
  const rect = el => {
    if (el === null) return null
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  }
  const box = (el, pseudo) => {
    if (el === null) return null
    const s = getComputedStyle(el, pseudo)
    return {
      display: s.display, width: s.width, minWidth: s.minWidth, maxWidth: s.maxWidth,
      flex: s.flex, flexShrink: s.flexShrink, flexBasis: s.flexBasis, flexWrap: s.flexWrap,
      alignItems: s.alignItems, whiteSpace: s.whiteSpace, wordBreak: s.wordBreak,
      overflowWrap: s.overflowWrap, position: s.position,
    }
  }
  const panel = document.querySelector('.dsh-atb-detailpanel')
  const detail = document.querySelector('.dsh-atb-detail')
  const checklist = document.querySelector('.dsh-atb-fieldcard[data-kind="checklist"]')
  const items = [...document.querySelectorAll('.dsh-atb-cl-item')]
  const scrollable = detail !== null && detail.scrollHeight > detail.clientHeight + 1
  const checklistTopInView = detail !== null && checklist !== null
    ? Math.round(checklist.getBoundingClientRect().top - detail.getBoundingClientRect().top)
    : null
  const lineHeightOf = text => {
    const lh = parseFloat(getComputedStyle(text).lineHeight)
    if (Number.isFinite(lh)) return lh
    return parseFloat(getComputedStyle(text).fontSize) * 1.4
  }
  // The comment composer: writing area + its buttons.
  const composer = document.querySelector('.dsh-atb-composer')
  const composerInput = document.querySelector('.dsh-atb-composer-input')
  const composerButtons = composer === null
    ? []
    : [...composer.querySelectorAll('button')].map(button => {
      const box = button.getBoundingClientRect()
      return { text: (button.textContent ?? '').trim().slice(0, 30), w: Math.round(box.width), h: Math.round(box.height), x: Math.round(box.x) }
    })
  return {
    status: document.querySelector('.dsh-atb-badge[data-kind="status"], .dsh-atb-card[data-selected]') !== null ? 'selected' : null,
    composer: composer === null ? null : {
      rect: rect(composer),
      style: box(composer),
      input: composerInput === null ? null : {
        rect: rect(composerInput),
        fontSize: getComputedStyle(composerInput).fontSize,
        minHeight: getComputedStyle(composerInput).minHeight,
        flex: getComputedStyle(composerInput).flex,
      },
      buttons: composerButtons,
      overflowRight: Math.round(composer.getBoundingClientRect().right - (composer.closest('.dsh-atb-detailpanel') ?? composer).getBoundingClientRect().right),
    },
    panel: rect(panel), detail: rect(detail),
    checklist: { rect: rect(checklist), style: box(checklist), label: checklist?.querySelector('.dsh-atb-fieldcard-label')?.textContent?.slice(0, 40) ?? null },
    drawer: detail === null ? null : {
      clientHeight: detail.clientHeight,
      scrollHeight: detail.scrollHeight,
      scrollTop: Math.round(detail.scrollTop),
      scrollable,
      // Where the checklist block starts inside the drawer viewport.
      checklistTopInView,
      blockCount: detail.children.length,
    },
    items: items.map(item => {
      const text = item.querySelector('.dsh-atb-cl-text')
      const meta = item.querySelector('.dsh-atb-cl-meta')
      const textRect = rect(text)
      const lh = text === null ? 0 : lineHeightOf(text)
      return {
        rect: rect(item),
        text: { rect: textRect, style: box(text), content: (text?.textContent ?? '').slice(0, 70) },
        meta: { rect: rect(meta), style: box(meta), content: (meta?.textContent ?? '').slice(0, 90) },
        lines: textRect === null || lh === 0 ? null : Math.round(textRect.h / lh),
        charsPerLine: textRect === null || textRect.h === 0 ? null : Number(((text?.textContent ?? '').length / Math.max(1, Math.round(textRect.h / lh))).toFixed(1)),
      }
    }),
    panelOverflowX: panel === null ? null : panel.scrollWidth - panel.clientWidth,
    viewport: { w: window.innerWidth, h: window.innerHeight },
  }
})

/** Screenshot the checklist block and the whole drawer in the current viewport. */
async function shoot(prefix) {
  const checklistEl = await page.$('.dsh-atb-fieldcard[data-kind="checklist"]')
  if (checklistEl !== null) await checklistEl.screenshot({ path: join(outDir, `${prefix}-checklist.png`) })
  const panelEl = await page.$('.dsh-atb-detailpanel')
  if (panelEl !== null) await panelEl.screenshot({ path: join(outDir, `${prefix}-detail-sheet.png`) })
}

const audit = { portrait: await measure() }
console.log('drawer:', JSON.stringify(audit.portrait.drawer))
await shoot('portrait')
// Can the user actually reach the checklist? Scroll the drawer to its end and
// measure again: an unreachable block is the real "not visible" failure.
await page.evaluate(() => {
  const detail = document.querySelector('.dsh-atb-detail')
  if (detail !== null) detail.scrollTop = detail.scrollHeight
})
await sleep(600)
audit.portraitScrolled = await measure()
console.log('scrolled:', JSON.stringify(audit.portraitScrolled.checklist.rect), JSON.stringify(audit.portraitScrolled.drawer))
await shoot('portrait-scrolled')
// Dedicated composer shot: scroll the writing area into view first.
await page.evaluate(() => document.querySelector('.dsh-atb-composer')?.scrollIntoView({ block: 'end' }))
await sleep(500)
const composerPanel = await page.$('.dsh-atb-detailpanel')
if (composerPanel !== null) await composerPanel.screenshot({ path: join(outDir, 'portrait-composer.png') })
console.log('portrait:', JSON.stringify(audit.portrait.items.map(item => ({ text: item.text.rect, meta: item.meta.rect, lines: item.lines, chars: item.charsPerLine }))))

// Phone shapes: is the checklist visible without scrolling on each one?
audit.shapes = {}
for (const shape of [
  { name: '390x844', width: 390, height: 844 },
  { name: '360x640', width: 360, height: 640 },
  { name: '412x915', width: 412, height: 915 },
  { name: '844x390', width: 844, height: 390 },
]) {
  await page.setViewport({ width: shape.width, height: shape.height, deviceScaleFactor: 2 })
  await sleep(900)
  await page.evaluate(() => {
    const detail = document.querySelector('.dsh-atb-detail')
    if (detail !== null) detail.scrollTop = 0
  })
  await sleep(300)
  const measured = await measure()
  const panel = measured.panel
  const drawer = measured.drawer
  audit.shapes[shape.name] = {
    focus: await page.evaluate(() => document.querySelector('.dsh-atb-board')?.getAttribute('data-atb-focus') ?? null),
    panel,
    drawer,
    checklistRect: measured.checklist.rect,
    composer: measured.composer,
    // Positive = the block starts below the drawer's visible area.
    belowFoldBy: panel === null || measured.checklist.rect === null
      ? null
      : Math.round(measured.checklist.rect.y - (panel.y + Math.min(panel.h, drawer?.clientHeight ?? panel.h))),
  }
  console.log('shape', shape.name, JSON.stringify(audit.shapes[shape.name]))
}
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
await sleep(600)

// Desktop pass: the same task, five-column layout, to prove the fix left the
// wide layout untouched.
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
await sleep(1200)
if ((await page.$('.dsh-atb-detailpanel')) === null) {
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.dsh-atb-card')]
    const card = cards.find(c => (c.querySelector('.dsh-atb-card-title')?.textContent ?? '').includes('Contrôle checklist'))
      ?? cards.find(c => c.querySelector('[data-kind="checklist"]') !== null)
    card?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  })
  await sleep(1200)
}
audit.desktop = await measure()
await shoot('desktop')
console.log('desktop:', JSON.stringify(audit.desktop.items.map(item => ({ text: item.text.rect, meta: item.meta.rect, lines: item.lines, chars: item.charsPerLine }))))

console.log(JSON.stringify(audit, null, 2))
writeFileSync(join(outDir, 'detail-audit.json'), JSON.stringify(audit, null, 2))
await page.screenshot({ path: join(outDir, 'detail-page.png') })
await browser.close()
