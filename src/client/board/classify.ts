/**
 * One-shot classification of EXISTING tasks (explicit user action only).
 *
 * New tasks get their category from the form, the agent tools or the external
 * label mapping. Historical tasks have none — by design they stay in the
 * "Général / Non classé" bucket, and the "colour by category" mode then shows a
 * neutral board. This module offers a deterministic, transparent migration the
 * user can trigger once, from the board hint or Settings:
 *
 *  1. remote labels (the same configurable map used at ingestion);
 *  2. otherwise a documented keyword heuristic over the title + description.
 *
 * Guarantees: it NEVER touches a task that already has a category, it never
 * runs implicitly (no render-time reclassification), the same input always
 * produces the same category, and the result is written through the ordinary
 * versioned update route (so version checks, archived/task boundaries and
 * validation still apply).
 *
 * @module dsh-taskboard/client/board/classify
 */
import type { BoardController } from '../controller.ts'
import type { TaskRecord } from '../../shared/protocol.ts'
import { categoryFromLabels, type TaskCategory } from '../../shared/categories.ts'

/** Keyword rules, from the most specific category to the broadest. */
const KEYWORD_RULES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['security', ['security', 'securite', 'vulnerability', 'vulnerabilite', 'cve', 'audit', 'secret', 'secrets', 'permission', 'permissions', 'auth', 'oauth', 'csrf', 'xss']],
  ['bug', ['bug', 'bugs', 'fix', 'fixes', 'fixed', 'corrige', 'corriger', 'correction', 'defect', 'defectueux', 'regression', 'crash', 'panne', 'erreur', 'erreurs', 'error', 'errors']],
  ['tests', ['test', 'tests', 'qa', 'spec', 'specs', 'coverage', 'couverture', 'e2e', 'vitest', 'jest']],
  ['documentation', ['doc', 'docs', 'documentation', 'readme', 'adr', 'guide', 'changelog', 'commentaire', 'commentaires']],
  ['design', ['design', 'ui', 'ux', 'maquette', 'mockup', 'ergonomie', 'accessibilite', 'a11y', 'theme', 'themes', 'typographie', 'layout']],
  ['performance', ['performance', 'perf', 'latence', 'latency', 'optimisation', 'optimization', 'profiling', 'profilage', 'bundle', 'memoire', 'memory', 'fuite']],
  ['infrastructure', ['ci', 'cd', 'pipeline', 'pipelines', 'docker', 'deploy', 'deployment', 'deploiement', 'infra', 'infrastructure', 'workflow', 'runner', 'build', 'release', 'nix', 'kubernetes']],
  ['research', ['recherche', 'research', 'spike', 'poc', 'prototype', 'exploration', 'experimentation', 'r&d', 'benchmark']],
  ['maintenance', ['maintenance', 'refactor', 'refactoring', 'refacto', 'dette', 'debt', 'cleanup', 'nettoyage', 'migration', 'upgrade', 'bump', 'deprecated', 'deprecation']],
  ['development', ['feature', 'fonctionnalite', 'implementation', 'implementer', 'dev', 'developpement', 'api', 'backend', 'frontend', 'endpoint', 'route', 'routes', 'composant', 'component', 'hook', 'module']],
]

/** Fold accents and lower-case a free-text value for matching. */
export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** True when a folded text contains one of the rule words (word/prefix match). */
export function matchesKeyword(folded: string, word: string): boolean {
  const tokens = folded.split(/[^a-z0-9&]+/).filter(Boolean)
  const needle = foldText(word)
  return tokens.some(token => needle.length >= 4 ? token.startsWith(needle) : token === needle)
}

/**
 * Category for one historical task: remote labels first, then the keyword
 * heuristic. Returns undefined when nothing matches (the task stays unclassified).
 */
export function classifyTask(
  task: Pick<TaskRecord, 'title' | 'description' | 'external'>,
  categories: readonly TaskCategory[],
  labelMap: Readonly<Record<string, string>>,
): string | undefined {
  const labels = task.external?.item.labels
  const fromLabels = categoryFromLabels(labels, labelMap, categories)
  if (fromLabels !== undefined) return fromLabels
  const known = new Set(categories.map(category => category.id))
  const haystack = foldText(`${task.title} ${task.description}`)
  for (const [categoryId, words] of KEYWORD_RULES) {
    if (!known.has(categoryId)) continue
    if (words.some(word => matchesKeyword(haystack, word))) return categoryId
  }
  return undefined
}

/** One planned classification (a task and the category it would receive). */
export interface ClassificationPlanEntry {
  id: string
  version: number
  title: string
  category: string
}

/**
 * Build the migration plan without writing anything. Only UNCLASSIFIED live
 * tasks are considered; a task whose heuristic finds nothing is left alone.
 */
export function planClassification(
  tasks: readonly TaskRecord[],
  categories: readonly TaskCategory[],
  labelMap: Readonly<Record<string, string>>,
): ClassificationPlanEntry[] {
  const plan: ClassificationPlanEntry[] = []
  for (const task of tasks) {
    if (task.trashedAt !== undefined || task.category !== undefined) continue
    const category = classifyTask(task, categories, labelMap)
    if (category === undefined) continue
    plan.push({ id: task.id, version: task.version, title: task.title, category })
  }
  return plan
}

/** Outcome of one migration run. */
export interface ClassificationResult {
  classified: number
  untouched: number
  failed: number
}

/**
 * Apply the plan through the controller's batch writer: the ordinary versioned
 * update route validates every entry (archived tasks, unknown categories,
 * stale versions), but the board is reconciled once at the end.
 */
export async function runClassification(
  controller: BoardController,
  options: { categories: readonly TaskCategory[]; labelMap: Readonly<Record<string, string>>; onProgress?: (done: number, total: number) => void },
): Promise<ClassificationResult> {
  const snapshot = controller.getSnapshot()
  const plan = planClassification(snapshot.ledger.tasks, options.categories, options.labelMap)
  if (plan.length === 0) return { classified: 0, untouched: snapshot.ledger.tasks.length, failed: 0 }
  options.onProgress?.(0, plan.length)
  const result = await controller.classifyTasks(plan.map(entry => ({ id: entry.id, ifVersion: entry.version, category: entry.category })))
  options.onProgress?.(plan.length, plan.length)
  return {
    classified: result.classified,
    untouched: snapshot.ledger.tasks.length - plan.length,
    failed: result.failed,
  }
}
