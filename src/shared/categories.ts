/**
 * Task categories ("catégories fonctionnelles") and the external-label mapping
 * that assigns them.
 *
 * Categories are USER DATA, not code: they live in the board settings (which
 * travel with the ledger, the JSON export/import and the host backups), they
 * can be renamed, recoloured, reordered and deleted, and a task stores only a
 * stable category id. Nothing here touches the execution or approval policy —
 * colouring is a pure projection of `category` + `urgency` (see
 * `client/board/coloring.ts`).
 *
 * Built-in defaults use the reference palette of the DeepSeek Pastel design
 * (light-theme HEX, dark variants hand-tuned in the same hue family). A
 * category the user deletes never deletes tasks: their stored id simply stops
 * resolving and they fall back to the "general" bucket.
 *
 * @module dsh-taskboard/shared/categories
 */

/** One functional category. */
export interface TaskCategory {
  /** Stable id (slug): lower-case letters, digits and hyphens. */
  id: string
  /** Display name (user data, editable). */
  name: string
  /** Light-theme reference colour, `#rrggbb`. */
  color: string
  /** Display order (ascending; ties fall back to the id). */
  order: number
}

/** The fallback bucket for unclassified tasks and unknown/deleted ids. */
export const GENERAL_CATEGORY_ID = 'general'

/** Maximum number of categories a board may declare. */
export const MAX_CATEGORIES = 64

/** Maximum display-name length. */
export const MAX_CATEGORY_NAME = 60

/** Valid category id: lower-case slug, 1..40 chars. */
const CATEGORY_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

/** True when `value` is a legal category id. */
export function isValidCategoryId(value: unknown): value is string {
  return typeof value === 'string' && CATEGORY_ID_RE.test(value)
}

/**
 * Normalize a display name or id into a category id slug. Accents are folded,
 * spaces become hyphens, and an all-invalid input yields an empty string (the
 * caller then falls back to {@link GENERAL_CATEGORY_ID}).
 */
export function slugifyCategoryId(value: string): string {
  const folded = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const slug = folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return CATEGORY_ID_RE.test(slug) ? slug : ''
}

/** Normalize a `#rrggbb` / `#rgb` colour to lower-case `#rrggbb` (undefined when invalid). */
export function asHexColor(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(value)) return value
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
  }
  return undefined
}

/**
 * The factory categories, in display order. Colours are the light-theme
 * references from the design; dark variants are derived by the colouring
 * module so custom categories get the same treatment.
 */
export const DEFAULT_CATEGORIES: readonly TaskCategory[] = [
  { id: 'development', name: 'Développement', color: '#a9c8f2', order: 0 },
  { id: 'bug', name: 'Bug / Correction', color: '#f1abb4', order: 1 },
  { id: 'design', name: 'Design / UI-UX', color: '#c5b2ef', order: 2 },
  { id: 'documentation', name: 'Documentation', color: '#9ed9c6', order: 3 },
  { id: 'tests', name: 'Tests / QA', color: '#f2c09d', order: 4 },
  { id: 'performance', name: 'Performance', color: '#eadd95', order: 5 },
  { id: 'security', name: 'Sécurité', color: '#d6a6c5', order: 6 },
  { id: 'infrastructure', name: 'Infrastructure / CI', color: '#a4d6dc', order: 7 },
  { id: 'research', name: 'Recherche / R&D', color: '#b8bbf0', order: 8 },
  { id: 'maintenance', name: 'Maintenance', color: '#c8cdd6', order: 9 },
  { id: GENERAL_CATEGORY_ID, name: 'Général / Non classé', color: '#e4e7ec', order: 10 },
]

/** The factory category list as a mutable copy. */
export function defaultCategories(): TaskCategory[] {
  return DEFAULT_CATEGORIES.map(category => ({ ...category }))
}

/**
 * Sanitize a persisted category list: drop malformed entries, de-duplicate
 * ids, clamp the length, and renumber the order densely. An empty or invalid
 * list falls back to the factory categories so a board always has the
 * documented palette.
 */
export function asTaskCategories(raw: unknown): TaskCategory[] {
  if (!Array.isArray(raw)) return defaultCategories()
  const out: TaskCategory[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as Record<string, unknown>
    const id = typeof candidate.id === 'string' ? candidate.id.trim().toLowerCase() : ''
    if (!isValidCategoryId(id) || seen.has(id)) continue
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    const color = asHexColor(candidate.color)
    if (name.length === 0 || name.length > MAX_CATEGORY_NAME || color === undefined) continue
    const order = typeof candidate.order === 'number' && Number.isFinite(candidate.order) ? candidate.order : out.length
    seen.add(id)
    out.push({ id, name, color, order })
    if (out.length >= MAX_CATEGORIES) break
  }
  if (out.length === 0) return defaultCategories()
  // 'general' must always be resolvable so unclassified tasks have a bucket;
  // it is kept last (the factory order) so the pickers stay predictable.
  if (!seen.has(GENERAL_CATEGORY_ID)) {
    const fallback = DEFAULT_CATEGORIES.find(category => category.id === GENERAL_CATEGORY_ID)!
    out.push({ ...fallback, order: Number.MAX_SAFE_INTEGER })
  }
  return out
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((category, index) => ({ ...category, order: index }))
}

/**
 * Resolve a category reference from a task write: an id (`development`) or a
 * display name (`Développement`). Unknown values return undefined so the host
 * can answer with an explicit validation error instead of silently
 * reclassifying the task.
 */
export function matchCategory(categories: readonly TaskCategory[], reference: string): TaskCategory | undefined {
  const needle = reference.trim()
  if (needle.length === 0) return undefined
  const byId = categories.find(category => category.id === needle.toLowerCase())
  if (byId !== undefined) return byId
  const folded = needle.toLocaleLowerCase()
  return categories.find(category => category.name.toLocaleLowerCase() === folded)
}

/** The category a task renders with: its own id when it still exists, else "general". */
export function categoryOf(categories: readonly TaskCategory[], categoryId: string | undefined): TaskCategory {
  const found = categoryId === undefined ? undefined : categories.find(category => category.id === categoryId)
  return found ?? categories.find(category => category.id === GENERAL_CATEGORY_ID) ?? DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1]!
}

// ---------------------------------------------------------------------------
// External label mapping (GitHub/GitLab/Jira/Linear/ZenTao/TAPD labels)
// ---------------------------------------------------------------------------

/**
 * Default label → category mapping. Matching is case-insensitive and
 * whitespace-tolerant; a custom rule for the same label replaces the default.
 */
export const DEFAULT_CATEGORY_LABEL_MAP: Readonly<Record<string, string>> = {
  feature: 'development',
  enhancement: 'development',
  bug: 'bug',
  fix: 'bug',
  defect: 'bug',
  design: 'design',
  ui: 'design',
  ux: 'design',
  docs: 'documentation',
  documentation: 'documentation',
  test: 'tests',
  tests: 'tests',
  qa: 'tests',
  performance: 'performance',
  perf: 'performance',
  security: 'security',
  ci: 'infrastructure',
  devops: 'infrastructure',
  infra: 'infrastructure',
  research: 'research',
  maintenance: 'maintenance',
}

/** Normalize one external label key for mapping lookups. */
export function normalizeLabelKey(label: string): string {
  return label.trim().toLowerCase()
}

/**
 * Sanitize the persisted mapping: keys are normalized labels, values must be
 * legal category ids. Unknown categories are dropped (the category may have
 * been deleted since), so a stale mapping can never resurrect a dead id.
 */
export function asCategoryLabelMap(raw: unknown, categories?: readonly TaskCategory[]): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_CATEGORY_LABEL_MAP }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  const known = categories === undefined ? undefined : new Set(categories.map(category => category.id))
  for (const [label, categoryId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof categoryId !== 'string') continue
    const key = normalizeLabelKey(label)
    if (key.length === 0 || !isValidCategoryId(categoryId)) continue
    if (known !== undefined && !known.has(categoryId)) continue
    out[key] = categoryId
  }
  return out
}

/**
 * Resolve the category of an external item from its labels.
 *
 * Precedence (documented, deterministic, independent of the category list
 * order): the rules are evaluated over an explicit rule order — custom rules
 * first in their stored order, then the factory defaults in declaration order —
 * and the FIRST matching label wins. Within one item the labels are scanned in
 * the order the forge returned them, so the result only depends on the stored
 * mapping and the item, never on render order or hash iteration.
 *
 * Returns undefined when nothing matches (caller keeps "general"/existing).
 */
export function categoryFromLabels(
  labels: readonly string[] | undefined,
  map: Readonly<Record<string, string>>,
  categories: readonly TaskCategory[],
): string | undefined {
  if (labels === undefined || labels.length === 0) return undefined
  const known = new Set(categories.map(category => category.id))
  // A stored value that differs from the factory default is a user override and
  // wins; the untouched factory rules and then any missing defaults follow.
  const overridden = Object.entries(map).filter(([label, categoryId]) => DEFAULT_CATEGORY_LABEL_MAP[label] !== categoryId)
  const kept = Object.entries(map).filter(([label, categoryId]) => DEFAULT_CATEGORY_LABEL_MAP[label] === categoryId)
  const missingDefaults = Object.entries(DEFAULT_CATEGORY_LABEL_MAP).filter(([label]) => !(label in map))
  const order: Array<[string, string]> = [...overridden, ...kept, ...missingDefaults]
  for (const [ruleLabel, categoryId] of order) {
    if (!known.has(categoryId)) continue
    for (const label of labels) {
      if (normalizeLabelKey(label) === ruleLabel) return categoryId
    }
  }
  return undefined
}

