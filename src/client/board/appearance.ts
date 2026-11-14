/**
 * Display-only appearance preferences for the board ("DeepSeek Pastel").
 *
 * Everything here is a LOCAL presentation choice: density, colour intensity,
 * the description/grouping switches and the optional manual card tones. None
 * of it is written to the ledger, so the data schema, the agent tools, the
 * import/export payload and the external synchronizations are untouched — a
 * board that has never opened this panel still renders correctly with the
 * defaults ({@link defaultAppearance}).
 *
 * Card tones are derived from the task id with a stable hash
 * ({@link hashTone}), never randomized at render time: the same task keeps its
 * tone across reloads, devices and teammates. A user may pin a tone per task
 * ({@link AppearancePrefs.tones}); that override lives in localStorage next to
 * the other display preferences and is dropped if the task disappears (a stale
 * id is harmless, it simply never matches a rendered card).
 *
 * The store is a tiny external store so React views can subscribe through
 * `useSyncExternalStore` without adding a context provider to the host tree.
 *
 * @module dsh-taskboard/client/board/appearance
 */
import { useSyncExternalStore } from 'react'

/** Card density presets, from the reference mockup. */
export type Density = 'compact' | 'comfortable' | 'spacious'

/** Every density, in menu order. */
export const DENSITIES: readonly Density[] = ['compact', 'comfortable', 'spacious']

/**
 * Default density: the mockup's airy card. A comfortable card also stays
 * readable at 300+ tasks because the title/description clamps do the work.
 */
export const DEFAULT_DENSITY: Density = 'spacious'

/** Colour-intensity range exposed in Settings (percentage of the tone kept). */
export const MIN_VIBRANCY = 25
/** Maximum (full pastel surface). */
export const MAX_VIBRANCY = 100
/** Step of the intensity range. */
export const VIBRANCY_STEP = 5
/** Default colour intensity (full pastel). */
export const DEFAULT_VIBRANCY = 100

/** The eight pastel tones of the reference palette. */
export type CardTone = 'violet' | 'sky' | 'mint' | 'peach' | 'pink' | 'ink' | 'yellow' | 'lavender'

/** Every tone, in palette order (the order used by the pickers). */
export const CARD_TONES: readonly CardTone[] = ['violet', 'sky', 'mint', 'peach', 'pink', 'ink', 'yellow', 'lavender']

/** Display preferences persisted in localStorage (never in the ledger). */
export interface AppearancePrefs {
  /** Card density. */
  density: Density
  /** Colour intensity in percent (MIN_VIBRANCY..MAX_VIBRANCY, step VIBRANCY_STEP). */
  vibrancy: number
  /** Render the task description on the card (clamped to two lines / one when compact). */
  descriptions: boolean
  /** Group each column by project. */
  group: boolean
  /** Manual per-task tone overrides; an absent id uses the deterministic hash. */
  tones: Record<string, CardTone>
}

/** localStorage key for the display preferences. */
export const APPEARANCE_KEY = 'dsh-taskboard-appearance-v1'

/** The factory appearance (a board that never opened Settings). */
export function defaultAppearance(): AppearancePrefs {
  return { density: DEFAULT_DENSITY, vibrancy: DEFAULT_VIBRANCY, descriptions: true, group: true, tones: {} }
}

/** Clamp an arbitrary number into the supported intensity range. */
export function clampVibrancy(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VIBRANCY
  const stepped = Math.round(value / VIBRANCY_STEP) * VIBRANCY_STEP
  return Math.min(MAX_VIBRANCY, Math.max(MIN_VIBRANCY, stepped))
}

/** Narrowing helper for a persisted tone. */
export function asCardTone(raw: unknown): CardTone | undefined {
  return typeof raw === 'string' && (CARD_TONES as readonly string[]).includes(raw)
    ? raw as CardTone
    : undefined
}

/**
 * Sanitize unknown persisted JSON into {@link AppearancePrefs}. Unknown fields
 * are dropped and every invalid value falls back to its default, so a
 * corrupted or older payload can never break the board.
 */
export function sanitizeAppearance(raw: unknown): AppearancePrefs {
  const out = defaultAppearance()
  if (typeof raw !== 'object' || raw === null) return out
  const value = raw as Record<string, unknown>
  if (typeof value.density === 'string' && (DENSITIES as readonly string[]).includes(value.density)) {
    out.density = value.density as Density
  }
  if (typeof value.vibrancy === 'number') out.vibrancy = clampVibrancy(value.vibrancy)
  if (typeof value.descriptions === 'boolean') out.descriptions = value.descriptions
  if (typeof value.group === 'boolean') out.group = value.group
  if (typeof value.tones === 'object' && value.tones !== null && !Array.isArray(value.tones)) {
    for (const [id, tone] of Object.entries(value.tones as Record<string, unknown>)) {
      const parsed = asCardTone(tone)
      if (id.length > 0 && parsed !== undefined) out.tones[id] = parsed
    }
  }
  return out
}

/** Read the persisted preferences (never throws; defaults on any failure). */
export function loadAppearance(): AppearancePrefs {
  if (typeof localStorage === 'undefined') return defaultAppearance()
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY)
    if (raw === null) return defaultAppearance()
    return sanitizeAppearance(JSON.parse(raw) as unknown)
  } catch {
    return defaultAppearance()
  }
}

/** Persist the preferences (best effort: private mode or quota must not break the UI). */
export function saveAppearance(prefs: AppearancePrefs): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(prefs))
  } catch {
    // Display-only preferences: losing them is a cosmetic loss, never an error.
  }
}

/**
 * Stable tone for a task id (FNV-1a over UTF-16 code units). The result only
 * depends on the id, so a card never changes colour between renders, reloads,
 * sessions or machines — unlike `Math.random()` or a list index.
 */
export function hashTone(id: string): CardTone {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return CARD_TONES[hash % CARD_TONES.length]!
}

/** Resolve the tone a card actually renders: manual override first, then the stable hash. */
export function toneForTask(id: string, prefs: AppearancePrefs = getAppearance()): CardTone {
  return prefs.tones[id] ?? hashTone(id)
}

/** Subscriber callback. */
export type AppearanceListener = () => void

/** Module singleton state (hydrated once from localStorage). */
let snapshot: AppearancePrefs = loadAppearance()
const listeners = new Set<AppearanceListener>()

/** Notify every subscriber after a mutation. */
function emit(): void {
  for (const listener of [...listeners]) listener()
}

/** Current preferences (stable reference until a mutation). */
export function getAppearance(): AppearancePrefs {
  return snapshot
}

/** Subscribe to preference changes; returns the unsubscribe handle. */
export function subscribeAppearance(listener: AppearanceListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Apply a partial update, persist it, and notify subscribers. */
export function setAppearance(patch: Partial<Omit<AppearancePrefs, 'tones'>>): AppearancePrefs {
  snapshot = sanitizeAppearance({ ...snapshot, ...patch, tones: snapshot.tones })
  saveAppearance(snapshot)
  emit()
  return snapshot
}

/** Pin (tone) or unpin (undefined) the tone of one task. */
export function setTaskTone(id: string, tone: CardTone | undefined): AppearancePrefs {
  const tones = { ...snapshot.tones }
  if (tone === undefined) delete tones[id]
  else tones[id] = tone
  snapshot = { ...snapshot, tones }
  saveAppearance(snapshot)
  emit()
  return snapshot
}

/** Drop every manual tone override (the deterministic palette takes over). */
export function clearTaskTones(): AppearancePrefs {
  snapshot = { ...snapshot, tones: {} }
  saveAppearance(snapshot)
  emit()
  return snapshot
}

/** Restore the factory appearance (used by the Settings "reset" action and tests). */
export function resetAppearance(): AppearancePrefs {
  snapshot = defaultAppearance()
  saveAppearance(snapshot)
  emit()
  return snapshot
}

/**
 * Re-read localStorage into the singleton. Used when another tab changed the
 * preferences (storage event) and by tests that seed storage after import.
 */
export function reloadAppearance(): AppearancePrefs {
  snapshot = loadAppearance()
  emit()
  return snapshot
}

/**
 * Subscribe a component to the appearance preferences.
 * `useSyncExternalStore` needs a server snapshot for the host's SSR path.
 */
export function useAppearance(): AppearancePrefs {
  return useSyncExternalStore(subscribeAppearance, getAppearance, defaultAppearance)
}
