/**
 * The **fictional** demo board shared by the README and hero capture scripts.
 *
 * Three invented projects, thirty invented tasks, no real workspace path, no
 * real project name and no real person: everything here is written by hand so
 * that a screenshot of the plugin never leaks a user's own ledger. The board is
 * seeded through the plugin's real `POST /import` route, and the isolated host
 * is the one booted by `pastel-visual-host.ps1` / `hero-shots.ps1`.
 *
 * Also hosts the few host-agnostic helpers both capture scripts need: waiting
 * for the panel, clearing the shell's first-run overlays, and the seeding call.
 *
 * @module dsh-taskboard/scripts/qa/demo-board
 */

/** Injected projects; the ids are fixed so the seeded ledger is deterministic. */
export const PROJECTS = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Atelier Lumen' },
  { id: '22222222-2222-4222-8222-222222222222', title: 'Nova Labs' },
  { id: '33333333-3333-4333-8333-333333333333', title: 'Studio Kestrel' },
]

/** The functional categories of the demo board (the shipped palette). */
export const CATEGORIES = [
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

/** DoD items for the demo tasks that carry one, half of them already checked. */
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

/** Build the JSON ledger the plugin's import route accepts (schema v1). */
export function buildLedger() {
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

/** Pause helper shared by the capture scripts. */
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Remove every full-viewport host layer that sits in front of the panel.
 *
 * A fresh isolated home greets the browser with the shell's **sign-in wall**
 * ("Connectez-vous / Ajouter une clé API"); a normal user dismisses it or is
 * already signed in, but it is a HOST element, so for a screenshot of the plugin
 * we either click its close button or hide that layer — never style the host
 * from plugin code. Every action is returned so the caller can record it.
 */
export async function clearOverlays(page, stage) {
  const record = { stage, clicks: [], hidden: [] }
  for (let step = 0; step < 10; step += 1) {
    const state = await page.evaluate(() => {
      const layers = [...document.querySelectorAll('div, section, aside')].filter(el => {
        const style = getComputedStyle(el)
        if (style.position !== 'fixed' || style.pointerEvents === 'none' || style.display === 'none') return false
        const box = el.getBoundingClientRect()
        return box.width >= window.innerWidth - 2 && box.height >= window.innerHeight * 0.7
      })
      return {
        count: layers.length,
        texts: layers.map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)),
        buttons: layers.flatMap(layer => [...layer.querySelectorAll('button')].map(button => {
          const box = button.getBoundingClientRect()
          return {
            text: (button.textContent ?? '').trim().slice(0, 40),
            x: Math.round(box.x + box.width / 2),
            y: Math.round(box.y + box.height / 2),
            width: Math.round(box.width),
            visible: box.width > 0 && box.height > 0,
          }
        }).map(button => ({ ...button, signIn: /connectez-vous|se connecter|sign in|api key|clé api/i.test(button.text) })))
          .flat()
          .filter(button => button.visible),
      }
    })
    if (state.count === 0) return record
    record.seen = state.texts
    // The sign-in wall is not dismissible with a click we can trust: hide it.
    const isSignIn = state.texts.some(text => /connectez-vous|se connecter|sign in|ajouter une clé api/i.test(text))
    if (isSignIn) {
      record.hidden.push(...await page.evaluate(() => {
        const layers = [...document.querySelectorAll('div, section, aside')].filter(el => {
          const style = getComputedStyle(el)
          if (style.position !== 'fixed' || style.pointerEvents === 'none' || style.display === 'none') return false
          const box = el.getBoundingClientRect()
          return box.width >= window.innerWidth - 2 && box.height >= window.innerHeight * 0.7
        })
        for (const layer of layers) layer.setAttribute('data-hero-hidden', 'true')
        return layers.map(layer => String(layer.className).slice(0, 40))
      }))
      await page.addStyleTag({ content: '[data-hero-hidden="true"] { display: none !important; }' })
      await sleep(500)
      continue
    }
    const target = state.buttons.find(button => /continue|continuer|compris|fermer|close|d'accord|ignorer|skip|plus tard|later/i.test(button.text))
      ?? state.buttons.find(button => button.width <= 44 && button.text.length === 0)
    if (target === undefined) { await page.keyboard.press('Escape'); await sleep(600); continue }
    record.clicks.push({ text: target.text, x: target.x, y: target.y })
    await page.mouse.click(target.x, target.y)
    await sleep(800)
  }
  return record
}

/**
 * Dismiss the shell's first-run dialogs (they cover the panel), then make sure
 * the task board panel is open. Idempotent: call it again after a reload.
 */
export async function ensurePanel(page) {
  const overlays = await clearOverlays(page, 'ensurePanel')
  await sleep(600)
  if ((await page.$('.dsh-atb-board')) === null) {
    await page.evaluate(() => document.querySelector('.dsh-atb-pglyph')?.closest('button')?.click())
  }
  // The demo board starts EMPTY (the store was wiped before boot): wait for the
  // panel itself, never for a card.
  await page.waitForSelector('.dsh-atb-board', { timeout: 45_000 })
  await sleep(800)
  return overlays
}

/**
 * Seed the demo board through the real import route (same origin, cookie sent).
 * Returns `{ ok, step, ... }` so the caller can fail loudly on a rejection.
 */
export async function seedBoard(page) {
  const ledger = buildLedger()
  return page.evaluate(async input => {
    const preview = await fetch('/dsh-taskboard/import/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }).then(response => response.json()).catch(error => ({ ok: false, error: String(error) }))
    if (preview?.ok !== true) return { ok: false, step: 'preview', preview }
    const invalid = preview.value?.plan?.invalid ?? []
    if (invalid.length > 0) return { ok: false, step: 'validation', invalid }
    const commit = await fetch('/dsh-taskboard/import', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'replace', ledger: input }),
    }).then(response => response.json()).catch(error => ({ ok: false, error: String(error) }))
    return { ok: commit?.ok === true, step: 'commit', commit }
  }, ledger)
}

/** The pastel appearance the README shots use: category colours, grouped. */
export const DEMO_APPEARANCE = {
  colorMode: 'category',
  intensity: 'balanced',
  density: 'comfortable',
  descriptions: true,
  group: true,
  tones: {},
  projectColors: {},
  priorityColors: {},
  priorityNuance: true,
}
