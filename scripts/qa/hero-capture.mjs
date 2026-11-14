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
 * Driven by `scripts/qa/hero-shots.ps1`, or run directly against a kept host:
 *   PTB_BASE=… PTB_TOKEN=… PTB_OUT=… PTB_BROWSER=… node scripts/qa/hero-capture.mjs
 *
 * @module dsh-taskboard/scripts/qa/hero-capture
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const base = process.env.PTB_BASE
const token = process.env.PTB_TOKEN
const outDir = process.env.PTB_OUT
const executablePath = process.env.PTB_BROWSER
if (!base || !token || !outDir || !executablePath) {
  console.error('missing PTB_BASE / PTB_TOKEN / PTB_OUT / PTB_BROWSER')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/* ---------------------------------------------------------------------------
 * The demo ledger. Every string here is invented on purpose.
 * ------------------------------------------------------------------------- */
const PROJECTS = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Atelier Lumen' },
  { id: '22222222-2222-4222-8222-222222222222', title: 'Nova Labs' },
  { id: '33333333-3333-4333-8333-333333333333', title: 'Studio Kestrel' },
]

const CATEGORIES = [
  { id: 'design', name: 'Design / UI-UX', color: '#c5b2ef', order: 0 },
  { id: 'development', name: 'Développement', color: '#a9c8f2', order: 1 },
  { id: 'bug', name: 'Bug / Correction', color: '#f1abb4', order: 2 },
  { id: 'tests', name: 'Tests / QA', color: '#f2c09d', order: 3 },
  { id: 'documentation', name: 'Documentation', color: '#9ed9c6', order: 4 },
  { id: 'performance', name: 'Performance', color: '#eadd95', order: 5 },
]

/** One demo task; `checklist` entries are plain strings, `checked` prefix marks done. */
const TASKS = [
  // backlog
  ['Affiner la palette pastel des cartes', 'backlog', 'normal', 'design', 'Atelier Lumen', true],
  ['Remplacer les icônes de la barre d’outils', 'backlog', 'normal', 'design', 'Atelier Lumen', false],
  ['Documenter le carrousel tactile', 'backlog', 'relaxed', 'documentation', 'Studio Kestrel', false],
  ['Préparer la démo client du 12 mars', 'backlog', 'urgent', 'design', 'Studio Kestrel', true],
  ['Mesurer le temps de rendu des colonnes', 'backlog', 'normal', 'performance', 'Nova Labs', false],
  ['Étudier un mode très contrasté', 'backlog', 'relaxed', 'design', 'Atelier Lumen', false],
  ['Nettoyer les anciennes captures', 'backlog', 'relaxed', 'documentation', 'Nova Labs', false],
  ['Réduire le poids du bundle client', 'backlog', 'normal', 'performance', 'Nova Labs', false],
  ['Ajouter une puce « en attente »', 'backlog', 'normal', 'development', 'Studio Kestrel', false],
  ['Tester le rendu en 1024 px', 'backlog', 'normal', 'tests', 'Nova Labs', false],
  ['Vérifier le contraste du gris', 'backlog', 'normal', 'design', 'Atelier Lumen', false],
  ['Préparer les visuels du README', 'backlog', 'relaxed', 'documentation', 'Studio Kestrel', false],
  // todo
  ['Corriger le contraste en thème sombre', 'todo', 'urgent', 'bug', 'Nova Labs', true],
  ['Tester le swipe sur tablette', 'todo', 'normal', 'tests', 'Studio Kestrel', false],
  ['Uniformiser les libellés d’actions', 'todo', 'normal', 'design', 'Atelier Lumen', false],
  ['Ajouter le filtre « en attente de moi »', 'todo', 'normal', 'development', 'Nova Labs', false],
  ['Revoir la fiche de tâche en mobile', 'todo', 'urgent', 'design', 'Atelier Lumen', true],
  ['Écrire les tests du snap horizontal', 'todo', 'normal', 'tests', 'Nova Labs', false],
  // in progress
  ['Refondre l’en-tête des colonnes', 'in_progress', 'urgent', 'design', 'Atelier Lumen', true],
  ['Migrer les données de démonstration', 'in_progress', 'normal', 'development', 'Nova Labs', false],
  ['Compacter la barre d’outils mobile', 'in_progress', 'normal', 'design', 'Studio Kestrel', false],
  // in review
  ['Checklist d’acceptation en mobile', 'in_review', 'urgent', 'design', 'Atelier Lumen', true],
  ['Composer de commentaire responsive', 'in_review', 'normal', 'design', 'Studio Kestrel', false],
  ['Onglets de colonnes en mini-en-têtes', 'in_review', 'normal', 'design', 'Atelier Lumen', false],
  ['Sécuriser l’import du carnet', 'in_review', 'urgent', 'bug', 'Nova Labs', false],
  // done
  ['Icônes monochromes', 'done', 'normal', 'design', 'Atelier Lumen', false],
  ['Thème pastel — première version', 'done', 'normal', 'design', 'Studio Kestrel', false],
  ['Glisser-déposer entre colonnes', 'done', 'normal', 'development', 'Nova Labs', false],
  ['Aperçu des quatre modes de couleur', 'done', 'relaxed', 'design', 'Atelier Lumen', false],
  ['Raccourcis clavier des onglets', 'done', 'normal', 'development', 'Studio Kestrel', false],
]

const CHECKLISTS = {
  'Checklist d’acceptation en mobile': [
    ['Grille vérifiée sur 360, 390 et 412 px', true],
    ['Trait de statut visible sur chaque onglet', true],
    ['Compteur intégré lisible', false],
    ['Aucun débordement horizontal', false],
  ],
  'Composer de commentaire responsive': [
    ['Champ plein largeur sur un écran de 390 px', true],
    ['Boutons sur leur propre ligne', false],
    ['Police de 16 px (pas de zoom iOS)', false],
  ],
  'Onglets de colonnes en mini-en-têtes': [
    ['Palette identique aux en-têtes desktop', true],
    ['État actif plus marqué', true],
    ['État pressé visible', false],
  ],
  'Sécuriser l’import du carnet': [
    ['Révision différée validée', true],
    ['Journal d’audit écrit', false],
  ],
  'Corriger le contraste en thème sombre': [
    ['Contraste ≥ 4,5:1 mesuré', true],
    ['Captures avant/après jointes', true],
  ],
}

function buildLedger() {
  const now = Date.now()
  const workspaceIdOf = title => PROJECTS.find(project => project.title === title).id
  const tasks = TASKS.map(([title, status, urgency, category, project, withChecklist], index) => {
    const id = `t-demo-${String(index + 1).padStart(3, '0')}`
    const task = {
      id,
      title,
      description: '',
      prompt: '',
      workspaceId: workspaceIdOf(project),
      urgency,
      status,
      category,
      blocked: false,
      execution: { mode: 'claim' },
      isolation: 'none',
      permission: 'workspace-write',
      version: 1,
      createdAt: now - (index + 1) * 3_600_000,
      updatedAt: now - index * 900_000,
      createdBy: { kind: 'user' },
      updatedBy: { kind: 'user' },
      comments: [],
      executions: [],
    }
    if (withChecklist && CHECKLISTS[title] !== undefined) {
      task.checklist = CHECKLISTS[title].map(([text, checked], itemIndex) => ({
        id: `k-${index}-${itemIndex}`,
        text,
        checked,
        checkedAt: checked ? now - itemIndex * 60_000 : null,
        checkedBy: checked ? 'user' : null,
      }))
    }
    if (status === 'in_review' && index % 2 === 0) {
      task.waitingForHuman = true
      task.waitingReason = 'Validation visuelle attendue avant fusion'
    }
    return task
  })
  return {
    schemaVersion: 1,
    revision: 1,
    tasks,
    settings: { categories: CATEGORIES, categoryLabelMap: {} },
  }
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  protocolTimeout: 180_000,
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb', '--lang=fr-FR', '--disable-extensions'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
})
const page = await browser.newPage()
page.on('pageerror', error => console.log('pageerror:', String(error)))
// The host follows the OS scheme; hero shots are taken in the light theme (the
// one the pastel palette is designed for). The plugin never forces a theme.
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
await page.goto(`${base}/?token=${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForFunction(() => document.querySelector('.dsh-atb-board .dsh-atb-card') !== null
  || document.querySelector('button .dsh-atb-pglyph') !== null
  || document.querySelector('[class*="_dialog_"]') !== null, { timeout: 60_000 })

/* Dismiss the shell's first-run dialogs (they cover the panel), then make sure
   the task board panel is open. Idempotent: called again after the reload. */
async function ensurePanel() {
  for (let step = 0; step < 10; step += 1) {
    const overlays = await page.evaluate(() => [...document.querySelectorAll('div, section, aside')]
      .filter(el => {
        const style = getComputedStyle(el)
        if (style.position !== 'fixed' || style.pointerEvents === 'none' || style.display === 'none') return false
        const box = el.getBoundingClientRect()
        return box.width >= window.innerWidth - 2 && box.height >= window.innerHeight * 0.7
      })
      .map(el => [...el.querySelectorAll('button')].map(button => {
        const box = button.getBoundingClientRect()
        return { text: (button.textContent ?? '').trim().slice(0, 40), x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), width: Math.round(box.width), visible: box.width > 0 }
      }))
      .flat()
      .filter(button => button.visible))
    if (overlays.length === 0) break
    const target = overlays.find(b => /continue|continuer|compris|fermer|close|d'accord|ignorer|skip|plus tard|later/i.test(b.text))
      ?? overlays.find(b => b.width <= 44 && b.text.length === 0)
    if (target === undefined) { await page.keyboard.press('Escape'); await sleep(600); continue }
    await page.mouse.click(target.x, target.y)
    await sleep(800)
  }
  if ((await page.$('.dsh-atb-board')) === null) {
    await page.evaluate(() => document.querySelector('.dsh-atb-pglyph')?.closest('button')?.click())
  }
  // The demo board starts EMPTY (the store was wiped before boot): wait for the
  // panel itself, never for a card.
  await page.waitForSelector('.dsh-atb-board', { timeout: 45_000 })
  await sleep(800)
}

await ensurePanel()

/* Seed the demo board through the real import route (same origin, cookie sent). */
const seeded = await page.evaluate(async ledger => {
  const preview = await fetch('/dsh-taskboard/import/preview', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ledger),
  }).then(response => response.json()).catch(error => ({ ok: false, error: String(error) }))
  if (preview?.ok !== true) return { ok: false, step: 'preview', preview }
  const invalid = preview.value?.plan?.invalid ?? []
  if (invalid.length > 0) return { ok: false, step: 'validation', invalid }
  const commit = await fetch('/dsh-taskboard/import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'replace', ledger }),
  }).then(response => response.json()).catch(error => ({ ok: false, error: String(error) }))
  return { ok: commit?.ok === true, step: 'commit', commit }
}, buildLedger())
console.log('seed:', JSON.stringify(seeded))
writeFileSync(join(outDir, 'hero-seed.json'), JSON.stringify(seeded, null, 2))

/* Force the pastel category colour mode with grouping on, then reload once. */
await page.evaluate(() => {
  localStorage.setItem('dsh-taskboard-appearance-v2', JSON.stringify({
    colorMode: 'category', intensity: 'balanced', density: 'comfortable',
    descriptions: true, group: true, tones: {}, projectColors: {}, priorityColors: {}, priorityNuance: true,
  }))
})
await page.reload({ waitUntil: 'domcontentloaded' })
await ensurePanel()
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
for (const shape of [
  { name: 'hero-desktop-1440x900', width: 1440, height: 900 },
  { name: 'hero-mobile-390x844', width: 390, height: 844 },
  { name: 'hero-landscape-844x390', width: 844, height: 390 },
]) {
  await page.setViewport({ width: shape.width, height: shape.height, deviceScaleFactor: 2 })
  await sleep(1400)
  const box = await panelBox()
  if (box === null) { console.log('no panel for', shape.name); continue }
  const file = join(outDir, `${shape.name}.png`)
  await page.screenshot({ path: file, clip: { x: box.x, y: box.y, width: box.width, height: box.height } })
  shots[shape.name] = { ...box, file }
  console.log(shape.name, JSON.stringify(box))
}

writeFileSync(join(outDir, 'hero-shots.json'), JSON.stringify({ seed: seeded.ok, shots }, null, 2))
const theme = await page.evaluate(() => ({
  dark: document.body.hasAttribute('data-ds-dark-theme'),
  scheme: getComputedStyle(document.documentElement).colorScheme,
}))
console.log('theme:', JSON.stringify(theme))
await browser.close()
