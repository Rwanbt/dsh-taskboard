/**
 * Colour system — the four modes, the priority families, the category nuance,
 * the category data model, the external label mapping and the agent-tool
 * integration. Pure functions only for the colour maths (no DOM, no store
 * beyond the documented tool harness), so a regression fails here first.
 *
 * @module dsh-taskboard/tests/color-modes
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CARD_TONES,
  COLOR_INTENSITIES,
  COLOR_MODES,
  DEFAULT_COLOR_INTENSITY,
  DEFAULT_COLOR_MODE,
  INTENSITY_VIBRANCY,
  NEUTRAL_TONE,
  PRIORITY_PALETTE,
  TONE_PALETTE,
  asHex,
  colorDistance,
  deriveDarkVariant,
  hexToHsl,
  hslToHex,
  isDistinctPriorityColor,
  lightDark,
  nuanceColor,
  priorityFamilyOf,
  resolveTaskColor,
  stableHash,
  toneForId,
  type ColorPreferences,
} from '../src/client/board/coloring.ts'
import { defaultAppearance } from '../src/client/board/appearance.ts'
import {
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_LABEL_MAP,
  GENERAL_CATEGORY_ID,
  MAX_CATEGORIES,
  asCategoryLabelMap,
  asTaskCategories,
  asHexColor,
  categoryFromLabels,
  categoryOf,
  defaultCategories,
  isValidCategoryId,
  matchCategory,
  slugifyCategoryId,
  type TaskCategory,
} from '../src/shared/categories.ts'
import {
  asBoardSettings,
  asTaskCategoryReference,
  categoriesOf,
  categoryLabelMapOf,
  validateImportedTask,
  type TaskRecord,
} from '../src/shared/protocol.ts'
import { registerTaskboardTools, type WorkspaceFace } from '../src/host/tools.ts'
import { TaskStore } from '../src/host/store.ts'

/** Preferences with sane defaults for a resolver call. */
function prefs(patch: Partial<ColorPreferences> = {}): ColorPreferences {
  return { ...defaultAppearance(), ...patch }
}

/** One task-shaped input for the resolver. */
function task(urgency: TaskRecord['urgency'], category?: string) {
  return { id: 't-color-1', workspaceId: 'ws-a', urgency, category }
}

const categories = defaultCategories()

describe('colour modes — one resolver for the four modes', () => {
  it('exposes the four documented modes, with category as the default', () => {
    expect(COLOR_MODES).toEqual(['card', 'project', 'category', 'priority'])
    expect(DEFAULT_COLOR_MODE).toBe('category')
    expect(DEFAULT_COLOR_INTENSITY).toBe('balanced')
    expect(COLOR_INTENSITIES).toEqual(['subtle', 'balanced', 'strong'])
    expect(INTENSITY_VIBRANCY).toEqual({ subtle: '45%', balanced: '75%', strong: '100%' })
  })

  it('mode "card" keeps a task colour stable across ids and properties', () => {
    const first = resolveTaskColor({ task: task('urgent'), categories, preferences: prefs({ colorMode: 'card', tones: {} }) })
    const second = resolveTaskColor({ task: { ...task('relaxed'), id: 't-color-1' }, categories, preferences: prefs({ colorMode: 'card', tones: {} }) })
    expect(first.mode).toBe('card')
    expect(first.background).toBe(second.background)
    expect(first.tone).toBe(toneForId('t-color-1'))
    // Manual override wins and never mutates task data.
    const manual = resolveTaskColor({ task: task('urgent'), categories, preferences: prefs({ colorMode: 'card', tones: { 't-color-1': 'peach' } }) })
    expect(manual.tone).toBe('peach')
    expect(manual.background).toBe(lightDark(TONE_PALETTE.peach.light, TONE_PALETTE.peach.dark))
  })

  it('mode "project" derives from the project id, not from the task', () => {
    const a = resolveTaskColor({ task: { ...task('urgent'), id: 't-1', workspaceId: 'ws-a' }, categories, preferences: prefs({ colorMode: 'project' }) })
    const b = resolveTaskColor({ task: { ...task('relaxed'), id: 't-2', workspaceId: 'ws-a' }, categories, preferences: prefs({ colorMode: 'project' }) })
    const c = resolveTaskColor({ task: { ...task('urgent'), id: 't-3', workspaceId: 'ws-b' }, categories, preferences: prefs({ colorMode: 'project' }) })
    expect(a.background).toBe(b.background)
    if (toneForId('ws-a') !== toneForId('ws-b')) expect(a.background).not.toBe(c.background)
    const manual = resolveTaskColor({ task: { ...task('normal'), id: 't-4', workspaceId: 'ws-a' }, categories, preferences: prefs({ colorMode: 'project', projectColors: { 'ws-a': 'mint' } }) })
    expect(manual.tone).toBe('mint')
  })

  it('mode "category" paints the category colour and falls back to the neutral bucket', () => {
    const development = categories.find(category => category.id === 'development')!
    const resolved = resolveTaskColor({ task: task('urgent', 'development'), categories, preferences: prefs() })
    expect(resolved.mode).toBe('category')
    expect(resolved.unclassified).toBe(false)
    expect(resolved.background).toBe(lightDark(development.color, deriveDarkVariant(development.color)))
    // Unknown / deleted category and no category both render as unclassified.
    for (const categoryId of [undefined, 'deleted-category']) {
      const fallback = resolveTaskColor({ task: task('normal', categoryId), categories, preferences: prefs() })
      expect(fallback.unclassified).toBe(true)
      expect(fallback.background).toBe(lightDark(NEUTRAL_TONE.light, NEUTRAL_TONE.dark))
    }
  })

  it('changes mode without losing any manual customisation', () => {
    const custom = prefs({ tones: { 't-color-1': 'pink' }, projectColors: { 'ws-a': 'sky' }, priorityColors: { normal: '#d9c4ff' } })
    const inCategory = resolveTaskColor({ task: task('normal', 'bug'), categories, preferences: { ...custom, colorMode: 'category' } })
    const inPriority = resolveTaskColor({ task: task('normal', 'bug'), categories, preferences: { ...custom, colorMode: 'priority' } })
    const backToCard = resolveTaskColor({ task: task('normal', 'bug'), categories, preferences: { ...custom, colorMode: 'card' } })
    expect(inCategory.tone).toBeUndefined()
    expect(inPriority.mode).toBe('priority')
    expect(backToCard.tone).toBe('pink')
  })
})

describe('mode "priority" — the three families are non-negotiable', () => {
  it('maps urgent → coral, normal → violet and relaxed → blue', () => {
    for (const urgency of ['urgent', 'normal', 'relaxed'] as const) {
      const resolved = resolveTaskColor({ task: task(urgency, 'development'), categories, preferences: prefs({ colorMode: 'priority', priorityNuance: false }) })
      const light = hexToHsl(PRIORITY_PALETTE[urgency].light)!
      expect(light).toBeDefined()
      expect(resolved.background).toBe(lightDark(PRIORITY_PALETTE[urgency].light, PRIORITY_PALETTE[urgency].dark))
      expect(priorityFamilyOf(PRIORITY_PALETTE[urgency].light)).toBe(urgency)
      expect(priorityFamilyOf(PRIORITY_PALETTE[urgency].dark)).toBe(urgency)
    }
  })

  it('keeps every category inside its priority family, with or without the nuance', () => {
    for (const urgency of ['urgent', 'normal', 'relaxed'] as const) {
      for (const category of categories) {
        for (const nuance of [true, false]) {
          const resolved = resolveTaskColor({ task: task(urgency, category.id), categories, preferences: prefs({ colorMode: 'priority', priorityNuance: nuance }) })
          const light = /light-dark\(([^,]+),/.exec(resolved.background)?.[1]?.trim()
          const dark = /, ([^)]+)\)/.exec(resolved.background)?.[1]?.trim()
          expect(light, `${urgency}/${category.id}`).toBeDefined()
          expect(priorityFamilyOf(light!)).toBe(urgency)
          expect(priorityFamilyOf(dark!)).toBe(urgency)
        }
      }
    }
  })

  it('the nuance varies the family deterministically and only in lightness/saturation', () => {
    const base = resolveTaskColor({ task: task('urgent', GENERAL_CATEGORY_ID), categories, preferences: prefs({ colorMode: 'priority', priorityNuance: true }) })
    const bug = resolveTaskColor({ task: task('urgent', 'bug'), categories, preferences: prefs({ colorMode: 'priority', priorityNuance: true }) })
    const bugAgain = resolveTaskColor({ task: task('urgent', 'bug'), categories, preferences: prefs({ colorMode: 'priority', priorityNuance: true }) })
    expect(bug.background).toBe(bugAgain.background)
    expect(bug.background).not.toBe(base.background)
    const lightBug = /light-dark\(([^,]+),/.exec(bug.background)![1]!.trim()
    const hsl = hexToHsl(lightBug)!
    const baseHsl = hexToHsl(PRIORITY_PALETTE.urgent.light)!
    expect(Math.abs(hsl.h - baseHsl.h)).toBeLessThanOrEqual(3)
    expect(priorityFamilyOf(lightBug)).toBe('urgent')
    // Unknown/custom category ids still resolve to a deterministic nuance.
    const custom = resolveTaskColor({ task: task('urgent', 'custom-analytics'), categories, preferences: prefs({ colorMode: 'priority', priorityNuance: true }) })
    const customAgain = resolveTaskColor({ task: task('urgent', 'custom-analytics'), categories, preferences: prefs({ colorMode: 'priority', priorityNuance: true }) })
    expect(custom.background).toBe(customAgain.background)
    expect(priorityFamilyOf(/light-dark\(([^,]+),/.exec(custom.background)![1]!.trim())).toBe('urgent')
  })

  it('the nuance is order-independent (categories can be reordered)', () => {
    const shuffled = [...categories].reverse().map((category, order) => ({ ...category, order }))
    const a = resolveTaskColor({ task: task('normal', 'documentation'), categories, preferences: prefs({ colorMode: 'priority' }) })
    const b = resolveTaskColor({ task: task('normal', 'documentation'), categories: shuffled, preferences: prefs({ colorMode: 'priority' }) })
    expect(a.background).toBe(b.background)
  })

  it('with the nuance off, one urgency has exactly one surface', () => {
    const surfaces = categories.map(category => resolveTaskColor({
      task: task('normal', category.id),
      categories,
      preferences: prefs({ colorMode: 'priority', priorityNuance: false }),
    }).background)
    expect(new Set(surfaces).size).toBe(1)
  })

  it('accepts a custom priority colour and derives its dark variant', () => {
    const custom = '#f0b8c0'
    const resolved = resolveTaskColor({ task: task('urgent', 'bug'), categories, preferences: prefs({ colorMode: 'priority', priorityNuance: false, priorityColors: { urgent: custom } }) })
    expect(resolved.background).toBe(lightDark(custom, deriveDarkVariant(custom)))
    expect(priorityFamilyOf(custom)).toBe('urgent')
    expect(deriveDarkVariant(custom)).not.toBe(custom)
  })

  it('refuses a custom colour that would blur two priorities together', () => {
    expect(isDistinctPriorityColor('urgent', PRIORITY_PALETTE.normal.light, { normal: PRIORITY_PALETTE.normal.light, relaxed: PRIORITY_PALETTE.relaxed.light })).toBe(false)
    expect(colorDistance(PRIORITY_PALETTE.urgent.light, PRIORITY_PALETTE.normal.light)).toBeGreaterThan(0)
    expect(isDistinctPriorityColor('urgent', '#f7b0b8', { normal: PRIORITY_PALETTE.normal.light, relaxed: PRIORITY_PALETTE.relaxed.light })).toBe(true)
  })

  it('ships light and dark references for every family and tone', () => {
    for (const urgency of ['urgent', 'normal', 'relaxed'] as const) {
      expect(asHex(PRIORITY_PALETTE[urgency].light)).toBe(PRIORITY_PALETTE[urgency].light)
      expect(asHex(PRIORITY_PALETTE[urgency].dark)).toBe(PRIORITY_PALETTE[urgency].dark)
    }
    for (const tone of CARD_TONES) {
      expect(asHex(TONE_PALETTE[tone].light)).toBe(TONE_PALETTE[tone].light)
      expect(asHex(TONE_PALETTE[tone].dark)).toBe(TONE_PALETTE[tone].dark)
    }
    // Dark surfaces stay genuinely dark (they sit under a light text colour).
    for (const category of categories) {
      const dark = deriveDarkVariant(category.color)
      expect(hexToHsl(dark)!.l).toBeGreaterThanOrEqual(20)
      expect(hexToHsl(dark)!.l).toBeLessThanOrEqual(34)
    }
  })

  it('has pure, deterministic colour maths', () => {
    expect(stableHash('t-1')).toBe(stableHash('t-1'))
    expect(stableHash('t-1')).not.toBe(stableHash('t-2'))
    const hsl = hexToHsl('#c5b2ef')!
    expect(hslToHex(hsl)).toBe('#c5b2ef')
    expect(nuanceColor('#c5b2ef', GENERAL_CATEGORY_ID, 'light')).toBe('#c5b2ef')
    expect(nuanceColor('#c5b2ef', 'bug', 'light')).toBe(nuanceColor('#c5b2ef', 'bug', 'light'))
  })
})

describe('categories — user data, validation and fallbacks', () => {
  it('ships the eleven documented categories, with the neutral general bucket', () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(11)
    expect(DEFAULT_CATEGORIES.map(category => category.id)).toContain(GENERAL_CATEGORY_ID)
    const colors = DEFAULT_CATEGORIES.map(category => category.color)
    expect(new Set(colors).size).toBe(DEFAULT_CATEGORIES.length)
  })

  it('sanitizes persisted categories (drop, dedupe, renumber, keep general)', () => {
    const cleaned = asTaskCategories([
      { id: 'development', name: 'Dév', color: '#A9C8F2', order: 5 },
      { id: 'development', name: 'Duplicate', color: '#000000', order: 6 },
      { id: 'Bad Id', name: 'Space', color: '#ffffff', order: 1 },
      { id: 'bug', name: '', color: '#ffffff', order: 2 },
      { id: 'tests', name: 'Tests', color: 'not-a-colour', order: 3 },
    ])
    expect(cleaned.map(category => category.id)).toEqual(['development', GENERAL_CATEGORY_ID])
    expect(cleaned[0]!.color).toBe('#a9c8f2')
    expect(cleaned.map(category => category.order)).toEqual([0, 1])
    // Missing/garbage lists fall back to the factory palette, never to nothing.
    expect(asTaskCategories(undefined).length).toBe(11)
    expect(asTaskCategories([]).length).toBe(11)
    expect(asTaskCategories('nope').length).toBe(11)
    // Bounded list.
    const many = Array.from({ length: MAX_CATEGORIES + 10 }, (_, index) => ({ id: `cat-${index}`, name: `Cat ${index}`, color: '#a9c8f2', order: index }))
    expect(asTaskCategories(many).length).toBeLessThanOrEqual(MAX_CATEGORIES + 1)
  })

  it('matches categories by id or display name and resolves unknown ids to general', () => {
    expect(matchCategory(categories, 'bug')?.id).toBe('bug')
    expect(matchCategory(categories, 'Bug / Correction')?.id).toBe('bug')
    expect(matchCategory(categories, 'développement')?.id).toBe('development')
    expect(matchCategory(categories, 'nope')).toBeUndefined()
    expect(categoryOf(categories, 'deleted').id).toBe(GENERAL_CATEGORY_ID)
    expect(categoryOf(categories, undefined).id).toBe(GENERAL_CATEGORY_ID)
  })

  it('slugifies names and validates ids/colours', () => {
    expect(slugifyCategoryId('Données / Analyse')).toBe('donnees-analyse')
    expect(slugifyCategoryId('!!!')).toBe('')
    expect(isValidCategoryId('research')).toBe(true)
    expect(isValidCategoryId('Research')).toBe(false)
    expect(asHexColor('#ABC')).toBe('#aabbcc')
    expect(asHexColor('red')).toBeUndefined()
  })

  it('derives categories from external labels with a documented precedence', () => {
    const map = asCategoryLabelMap(undefined, categories)
    expect(categoryFromLabels(['bug'], map, categories)).toBe('bug')
    expect(categoryFromLabels(['enhancement'], map, categories)).toBe('development')
    expect(categoryFromLabels(['unknown-label'], map, categories)).toBeUndefined()
    expect(categoryFromLabels([], map, categories)).toBeUndefined()
    // A custom rule wins over the factory default for the same label.
    const custom = asCategoryLabelMap({ ui: 'research', bug: 'maintenance' }, categories)
    expect(categoryFromLabels(['ui'], custom, categories)).toBe('research')
    expect(categoryFromLabels(['bug'], custom, categories)).toBe('maintenance')
    // A mapping pointing at a deleted category is dropped, not applied.
    const stale = asCategoryLabelMap({ bug: 'deleted-category' }, categories)
    expect(stale.bug).toBe(DEFAULT_CATEGORY_LABEL_MAP.bug)
    expect(asCategoryLabelMap({ bug: 'deleted-category' }, [])).toEqual(expect.objectContaining({ bug: 'bug' }))
  })
})

describe('persistence round-trip — settings, import and agent tools', () => {
  let dir: string
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'tb-color-')) })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  const workspaces: WorkspaceFace = {
    resolveByPath: async path => (path === '/proj/a' ? { id: 'ws-a' } : undefined),
    get: id => (id === 'ws-a' ? { id: 'ws-a', path: '/proj/a', title: 'A' } : undefined),
    list: () => [{ id: 'ws-a', path: '/proj/a', title: 'A' }],
  }

  it('sanitizes settings categories and the label map together', () => {
    const settings = asBoardSettings({
      categories: [
        { id: 'development', name: 'Développement', color: '#a9c8f2', order: 0 },
        { id: 'analytics', name: 'Analytique', color: '#c5b2ef', order: 1 },
      ],
      categoryLabelMap: { data: 'analytics', bug: 'deleted' },
    })
    expect(settings.categories?.map(category => category.id)).toEqual(['development', 'analytics', GENERAL_CATEGORY_ID])
    expect(settings.categoryLabelMap?.data).toBe('analytics')
    expect(settings.categoryLabelMap?.bug).toBe('bug')
    expect(categoriesOf(settings).map(category => category.id)).toEqual(['development', 'analytics', GENERAL_CATEGORY_ID])
    expect(categoryLabelMapOf(undefined).bug).toBe('bug')
    // Task references accept id, name, null/empty (clear) and refuse unknown.
    expect(asTaskCategoryReference(settings, 'analytics')).toBe('analytics')
    expect(asTaskCategoryReference(settings, 'Analytique')).toBe('analytics')
    expect(asTaskCategoryReference(settings, null)).toBeUndefined()
    expect(asTaskCategoryReference(settings, '  ')).toBeUndefined()
    expect(() => asTaskCategoryReference(settings, 'nope')).toThrow(/unknown category/)
  })

  it('keeps a valid category through a JSON import and drops a malformed one', () => {
    const base = {
      id: 't-import-1', title: 'Imported', description: '', prompt: '', workspaceId: 'ws-a',
      urgency: 'normal', status: 'todo', blocked: false, execution: { mode: 'claim' },
      version: 1, createdAt: 1, updatedAt: 1, createdBy: { kind: 'user' }, updatedBy: { kind: 'user' },
      comments: [], executions: [],
    }
    const good = validateImportedTask({ ...base, category: 'documentation' }, 7_000)
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.task.category).toBe('documentation')
    const bad = validateImportedTask({ ...base, category: 'Not A Slug' }, 7_000)
    expect(bad.ok).toBe(true)
    if (bad.ok) expect(bad.task.category).toBeUndefined()
  })

  it('lets agents set, filter and clear a category through taskboard_*', async () => {
    const store = new TaskStore({ file: join(dir, 'ledger.json') })
    const settings = asBoardSettings({
      categories: [
        { id: 'development', name: 'Développement', color: '#a9c8f2', order: 0 },
        { id: 'analytics', name: 'Analytique', color: '#c5b2ef', order: 1 },
      ],
      categoryLabelMap: { data: 'analytics' },
    })
    await store.mutate('settings-updated', ledger => { ledger.settings = settings; return [] })
    const registered: Array<Record<string, unknown>> = []
    registerTaskboardTools({ tools: { register: tool => { registered.push(tool); return () => {} } } }, { store, workspaces, now: () => 7_000 })
    const tool = (name: string) => registered.find(entry => entry.name === name) as {
      execute(args: unknown, exec: unknown): Promise<unknown>
    }
    const exec = { agent: { id: 'session-1', session: { header: { cwd: '/proj/a' } } } }

    const created = await tool('taskboard_create').execute({ title: 'Categorized', workspaceId: 'ws-a', urgency: 'normal', category: 'Analytique' }, exec) as { task: { id: string; category?: string } }
    expect(created.task.category).toBe('analytics')
    const id = created.task.id
    const listed = await tool('taskboard_list').execute({ category: 'analytics' }, exec) as { tasks: Array<{ id: string }> }
    expect(listed.tasks.map(entry => entry.id)).toContain(id)
    const otherList = await tool('taskboard_list').execute({ category: 'development' }, exec) as { tasks: Array<{ id: string }> }
    expect(otherList.tasks.map(entry => entry.id)).not.toContain(id)
    // Unknown category: explicit failure, never a silent reclassification.
    await expect(tool('taskboard_create').execute({ title: 'Bad', workspaceId: 'ws-a', urgency: 'normal', category: 'nope' }, exec)).rejects.toThrow()
    // Update sets it, then null clears it.
    await tool('taskboard_update').execute({ id, ifVersion: 1, category: 'development' }, exec)
    expect(store.get(id)?.category).toBe('development')
    await tool('taskboard_update').execute({ id, ifVersion: 2, category: null }, exec)
    expect(store.get(id)?.category).toBeUndefined()
  })
})
