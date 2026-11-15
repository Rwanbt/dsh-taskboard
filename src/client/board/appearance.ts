/**
 * Display-only appearance preferences for the board ("DeepSeek Pastel").
 *
 * Everything here is a LOCAL presentation choice: colour mode, intensity,
 * density, the description/grouping switches, per-card and per-project tone
 * overrides, the optional priority palette and the priority-nuance toggle.
 * None of it is written to the ledger, so the data schema, the agent tools, the
 * import/export payload and the external synchronizations are untouched — a
 * board that never opened this panel renders with {@link defaultAppearance}
 * (colour by category, balanced intensity).
 *
 * Categories and the external label mapping are NOT here: they are shared user
 * data and live in `BoardSettings` (see `shared/categories.ts`).
 *
 * Storage is versioned and fail-soft: a v1 payload (the earlier density/
 * vibrancy build) is migrated on read, and any corrupted entry falls back to
 * the defaults instead of breaking the board.
 *
 * @module dsh-taskboard/client/board/appearance
 */
import { useSyncExternalStore } from 'react'
import type { Urgency } from '../../shared/protocol.ts'
import {
  CARD_TONES,
  COLOR_INTENSITIES,
  COLOR_MODES,
  DEFAULT_COLOR_INTENSITY,
  DEFAULT_COLOR_MODE,
  INTENSITY_VIBRANCY,
  asHex,
  stableHash,
  type CardTone,
  type ColorIntensity,
  type ColorMode,
} from './coloring.ts'

/** Card density presets, from the reference mockup. */
export type Density = 'compact' | 'comfortable' | 'spacious'

/** Every density, in menu order. */
export const DENSITIES: readonly Density[] = ['compact', 'comfortable', 'spacious']

/**
 * Default density: the mockup's airy card. A comfortable card also stays
 * readable at 300+ tasks because the title/description clamps do the work.
 */
export const DEFAULT_DENSITY: Density = 'spacious'

/** Colour-intensity range kept for backwards compatibility of the CSS bridge. */
export const MIN_VIBRANCY = 45
/** Maximum (full pastel surface). */
export const MAX_VIBRANCY = 100
/** Step of the intensity range. */
export const VIBRANCY_STEP = 5
/** Default colour intensity (full pastel) — see {@link DEFAULT_COLOR_INTENSITY}. */
export const DEFAULT_VIBRANCY = 100

/** The eight pastel tones of the reference palette (re-exported for callers). */
export { CARD_TONES }
export type { CardTone }

/** Display preferences persisted in localStorage (never in the ledger). */
export interface AppearancePrefs {
  /** How the card background is chosen. Default: category. */
  colorMode: ColorMode
  /** Colour strength preset. Default: balanced. */
  intensity: ColorIntensity
  /** Card density. */
  density: Density
  /** Render the task description on the card (clamped to two lines / one when compact). */
  descriptions: boolean
  /** Group each column by project. */
  group: boolean
  /** Manual per-task tone overrides (mode "card"). */
  tones: Record<string, CardTone>
  /** Manual per-project tone overrides (mode "project"). */
  projectColors: Record<string, CardTone>
  /** Mode "priority": optional custom light-theme reference colours. */
  priorityColors: Partial<Record<Urgency, string>>
  /** Mode "priority": nuance the urgency family by category (default true). */
  priorityNuance: boolean
}

/** localStorage key for the display preferences (v2: colour modes). */
export const APPEARANCE_KEY = 'dsh-taskboard-appearance-v2'
/** Legacy key (v1: density + percentage intensity) — read once for migration. */
export const LEGACY_APPEARANCE_KEY = 'dsh-taskboard-appearance-v1'

/** The factory appearance (a board that never opened Settings). */
export function defaultAppearance(): AppearancePrefs {
  return {
    colorMode: DEFAULT_COLOR_MODE,
    intensity: DEFAULT_COLOR_INTENSITY,
    density: DEFAULT_DENSITY,
    descriptions: true,
    group: true,
    tones: {},
    projectColors: {},
    priorityColors: {},
    priorityNuance: true,
  }
}

/** Map a legacy percentage to the nearest named intensity preset. */
export function intensityFromVibrancy(vibrancy: number): ColorIntensity {
  if (!Number.isFinite(vibrancy)) return DEFAULT_COLOR_INTENSITY
  if (vibrancy <= 55) return 'subtle'
  if (vibrancy <= 85) return 'balanced'
  return 'strong'
}

/** The CSS custom-property value the board sets for the current intensity. */
export function vibrancyOf(prefs: AppearancePrefs): string {
  return INTENSITY_VIBRANCY[prefs.intensity]
}

/** Clamp an arbitrary number into the legacy intensity range. */
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

/** Narrowing helper for a persisted colour mode. */
export function asColorMode(raw: unknown): ColorMode | undefined {
  return typeof raw === 'string' && (COLOR_MODES as readonly string[]).includes(raw)
    ? raw as ColorMode
    : undefined
}

/** Narrowing helper for a persisted intensity. */
export function asColorIntensity(raw: unknown): ColorIntensity | undefined {
  return typeof raw === 'string' && (COLOR_INTENSITIES as readonly string[]).includes(raw)
    ? raw as ColorIntensity
    : undefined
}

/** Read a `Record<id, tone>` maps field, dropping unknown ids and tones. */
function asToneMap(raw: unknown): Record<string, CardTone> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, CardTone> = {}
  for (const [id, tone] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = asCardTone(tone)
    if (id.length > 0 && parsed !== undefined) out[id] = parsed
  }
  return out
}

/** Read the custom priority colours, dropping invalid hues/values. */
function asPriorityColors(raw: unknown): Partial<Record<Urgency, string>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Partial<Record<Urgency, string>> = {}
  for (const urgency of ['urgent', 'normal', 'relaxed'] as const) {
    const color = asHex((raw as Record<string, unknown>)[urgency])
    if (color !== undefined) out[urgency] = color
  }
  return out
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
  const mode = asColorMode(value.colorMode)
  if (mode !== undefined) out.colorMode = mode
  const intensity = asColorIntensity(value.intensity)
  if (intensity !== undefined) out.intensity = intensity
  if (typeof value.density === 'string' && (DENSITIES as readonly string[]).includes(value.density)) {
    out.density = value.density as Density
  }
  if (typeof value.descriptions === 'boolean') out.descriptions = value.descriptions
  if (typeof value.group === 'boolean') out.group = value.group
  if (typeof value.priorityNuance === 'boolean') out.priorityNuance = value.priorityNuance
  out.tones = asToneMap(value.tones)
  out.projectColors = asToneMap(value.projectColors)
  out.priorityColors = asPriorityColors(value.priorityColors)
  // v1 migration: a saved percentage maps to the closest named preset, and the
  // old per-card tones are preserved (they are the "mode card" overrides).
  if (out.colorMode === DEFAULT_COLOR_MODE && value.colorMode === undefined && typeof value.vibrancy === 'number') {
    out.intensity = intensityFromVibrancy(value.vibrancy)
  }
  return out
}

/** Read the persisted preferences (never throws; defaults on any failure). */
export function loadAppearance(): AppearancePrefs {
  if (typeof localStorage === 'undefined') return defaultAppearance()
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY)
    if (raw !== null) return sanitizeAppearance(JSON.parse(raw) as unknown)
    const legacy = localStorage.getItem(LEGACY_APPEARANCE_KEY)
    if (legacy !== null) return sanitizeAppearance(JSON.parse(legacy) as unknown)
    return defaultAppearance()
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
 * Stable tone for a task id (FNV-1a). Exposed for mode "card"; the actual
 * resolver lives in `coloring.ts` so every mode shares one implementation.
 */
export function hashTone(id: string): CardTone {
  return CARD_TONES[stableHash(id) % CARD_TONES.length]!
}

/** Resolve the tone a card renders in "card" mode: override first, then the hash. */
export function toneForTask(id: string, prefs: AppearancePrefs = getAppearance()): CardTone {
  return prefs.tones[id] ?? hashTone(id)
}

/** Resolve the tone a project renders in "project" mode: override first, then the hash. */
export function toneForProject(workspaceId: string, prefs: AppearancePrefs = getAppearance()): CardTone {
  return prefs.projectColors[workspaceId] ?? hashTone(workspaceId)
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

/** Apply a partial update (maps replaced whole), persist it, and notify subscribers. */
export function setAppearance(patch: Partial<AppearancePrefs>): AppearancePrefs {
  snapshot = sanitizeAppearance({ ...snapshot, ...patch })
  saveAppearance(snapshot)
  emit()
  return snapshot
}

/** Pin (tone) or unpin (undefined) the tone of one task (mode "card"). */
export function setTaskTone(id: string, tone: CardTone | undefined): AppearancePrefs {
  const tones = { ...snapshot.tones }
  if (tone === undefined) delete tones[id]
  else tones[id] = tone
  snapshot = { ...snapshot, tones }
  saveAppearance(snapshot)
  emit()
  return snapshot
}

/** Drop every manual task tone (the deterministic palette takes over). */
export function clearTaskTones(): AppearancePrefs {
  snapshot = { ...snapshot, tones: {} }
  saveAppearance(snapshot)
  emit()
  return snapshot
}

/** Pin (tone) or unpin (undefined) the colour of one project (mode "project"). */
export function setProjectTone(workspaceId: string, tone: CardTone | undefined): AppearancePrefs {
  const projectColors = { ...snapshot.projectColors }
  if (tone === undefined) delete projectColors[workspaceId]
  else projectColors[workspaceId] = tone
  snapshot = { ...snapshot, projectColors }
  saveAppearance(snapshot)
  emit()
  return snapshot
}

/** Drop every manual project colour. */
export function clearProjectColors(): AppearancePrefs {
  snapshot = { ...snapshot, projectColors: {} }
  saveAppearance(snapshot)
  emit()
  return snapshot
}

/** Set (hex) or clear (undefined) one custom priority colour. */
export function setPriorityColor(urgency: Urgency, color: string | undefined): AppearancePrefs {
  const priorityColors = { ...snapshot.priorityColors }
  const normalized = asHex(color)
  if (normalized === undefined) delete priorityColors[urgency]
  else priorityColors[urgency] = normalized
  snapshot = { ...snapshot, priorityColors }
  saveAppearance(snapshot)
  emit()
  return snapshot
}

/** Drop every custom priority colour (documented factory families return). */
export function clearPriorityColors(): AppearancePrefs {
  snapshot = { ...snapshot, priorityColors: {} }
  saveAppearance(snapshot)
  emit()
  return snapshot
}

/** Restore the factory appearance (Settings "reset" action and tests). */
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
