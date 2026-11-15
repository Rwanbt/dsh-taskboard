/**
 * Card colouring — ONE deterministic resolver for the four colour modes.
 *
 * The colour of a card is a pure projection of task data + display
 * preferences; it never writes anything and never depends on render order,
 * list position or randomness:
 *
 *   mode 'card'     → stable hash of the task id (+ the user's manual pick)
 *   mode 'project'  → stable hash of the project id (+ the user's manual pick)
 *   mode 'category' → the task's functional category (default mode)
 *   mode 'priority' → urgency family, optionally nuanced per category
 *
 * In 'priority' mode the three urgency families are non-negotiable: coral for
 * urgent, violet for normal, blue for relaxed. The optional category nuance
 * only moves lightness/saturation (and at most ±3° of hue) inside that family,
 * so an urgent task can never read as blue. The nuance offsets are derived
 * from a hash of the category id, which makes them stable across sessions,
 * independent of the category list order, and defined for unknown categories.
 *
 * Themes are produced as `light-dark(<light>, <dark>)` values: the host
 * publishes `color-scheme` from its active theme, so the resolved colour follows
 * the shell without reading host internals and without any JS theme detection.
 *
 * @module dsh-taskboard/client/board/coloring
 */
import type { TaskRecord, Urgency } from '../../shared/protocol.ts'
import { GENERAL_CATEGORY_ID, categoryOf, type TaskCategory } from '../../shared/categories.ts'

/** The four colour modes exposed in Settings → Appearance. */
export type ColorMode = 'card' | 'project' | 'category' | 'priority'

/** Every mode, in menu order. */
export const COLOR_MODES: readonly ColorMode[] = ['card', 'project', 'category', 'priority']

/** Default mode: the functional category (per the design brief). */
export const DEFAULT_COLOR_MODE: ColorMode = 'category'

/** The three colour-intensity presets. */
export type ColorIntensity = 'subtle' | 'balanced' | 'strong'

/** Every intensity, in menu order. */
export const COLOR_INTENSITIES: readonly ColorIntensity[] = ['subtle', 'balanced', 'strong']

/** Default intensity: balanced. */
export const DEFAULT_COLOR_INTENSITY: ColorIntensity = 'balanced'

/**
 * How much of the resolved tone survives over the host surface. The three
 * presets are expressed as percentages so the CSS mixer stays the single
 * implementation of "intensity".
 */
export const INTENSITY_VIBRANCY: Readonly<Record<ColorIntensity, string>> = {
  subtle: '45%',
  balanced: '75%',
  strong: '100%',
}

/** The eight pastel families of mode "card"/"project". */
export type CardTone = 'violet' | 'sky' | 'mint' | 'peach' | 'pink' | 'ink' | 'yellow' | 'lavender'

/** Every palette tone, in picker order. */
export const CARD_TONES: readonly CardTone[] = ['violet', 'sky', 'mint', 'peach', 'pink', 'ink', 'yellow', 'lavender']

/** Light/dark surfaces per family (dark values match the reference mockup). */
export const TONE_PALETTE: Readonly<Record<CardTone, { light: string; dark: string }>> = {
  violet: { light: '#e9e3fb', dark: '#34304d' },
  sky: { light: '#dfeef9', dark: '#283d50' },
  mint: { light: '#dff2e8', dark: '#2d4642' },
  peach: { light: '#f9e7d9', dark: '#4a3a33' },
  pink: { light: '#f7e3ed', dark: '#4b3443' },
  ink: { light: '#e0e8f4', dark: '#323c4f' },
  yellow: { light: '#f7edcf', dark: '#49412e' },
  lavender: { light: '#e6e0f8', dark: '#3b3454' },
}

/** Priority families: the light HEX is the documented reference colour. */
export const PRIORITY_PALETTE: Readonly<Record<Urgency, { light: string; dark: string }>> = {
  urgent: { light: '#f1abb4', dark: '#553238' },
  normal: { light: '#c5b2ef', dark: '#40355c' },
  relaxed: { light: '#a9c8f2', dark: '#2f4159' },
}

/** Neutral surface for the "general / unclassified" bucket. */
export const NEUTRAL_TONE = { light: '#e4e7ec', dark: '#2a2d33' }

/** Preferences the resolver reads (a narrowed view of the appearance store). */
export interface ColorPreferences {
  colorMode: ColorMode
  intensity: ColorIntensity
  /** Manual per-task family overrides (mode "card"). */
  tones: Readonly<Record<string, CardTone>>
  /** Manual per-project family overrides (mode "project"). */
  projectColors: Readonly<Record<string, CardTone>>
  /** Mode "priority": nuance the urgency family by category (default on). */
  priorityNuance: boolean
  /** Mode "priority": optional custom light-theme reference colours. */
  priorityColors: Partial<Record<Urgency, string>>
}

/**
 * A manual priority colour is accepted only when it stays readable: the three
 * pastel families share a high lightness, so the guard is a moderate RGB
 * distance (60 ≈ a clearly visible hue/lightness difference at these tones).
 */
export const MIN_PRIORITY_DISTANCE = 60

/** Result of the resolver: ready-to-render CSS values. */
export interface ResolvedCardColor {
  mode: ColorMode
  /** `light-dark(...)` surface for `--atb-card-bg`. */
  background: string
  /** `light-dark(...)` accent for the project/category dot and ring. */
  accent: string
  /** Resolved family for `data-tone` (undefined in category/priority mode). */
  tone?: CardTone
  /** The task's effective category (never undefined: falls back to general). */
  category: TaskCategory
  /** True when the task has no explicit category (general bucket). */
  unclassified: boolean
}

/** `light-dark()` is the host-theme bridge; keep one producer for every mode. */
export function lightDark(light: string, dark: string): string {
  return `light-dark(${light}, ${dark})`
}

// ---------------------------------------------------------------------------
// Colour maths (pure HSL, no dependencies)
// ---------------------------------------------------------------------------

interface Hsl { h: number; s: number; l: number }

/** Parse `#rrggbb`/`#rgb` into HSL (undefined when malformed). */
export function hexToHsl(hex: string): Hsl | undefined {
  const normalized = asHex(hex)
  if (normalized === undefined) return undefined
  const r = Number.parseInt(normalized.slice(1, 3), 16) / 255
  const g = Number.parseInt(normalized.slice(3, 5), 16) / 255
  const b = Number.parseInt(normalized.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
  }
  h *= 60
  if (h < 0) h += 360
  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  return { h, s: s * 100, l: l * 100 }
}

/** Format HSL back to lower-case `#rrggbb`. */
export function hslToHex({ h, s, l }: Hsl): string {
  const saturation = clamp(s, 0, 100) / 100
  const lightness = clamp(l, 0, 100) / 100
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lightness - c / 2
  const [r, g, b] = hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x]
  const channel = (value: number): string => Math.round(clamp((value + m) * 255, 0, 255)).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** Clamp a number into a range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Re-export the shared hex normalizer under a colouring-friendly name. */
export function asHex(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(value)) return value
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
  }
  return undefined
}

/**
 * Derive the dark-theme variant of a light reference colour: same hue, much
 * lower lightness, moderate saturation. Used for custom categories, custom
 * priority colours and every non-palette hex, so one rule covers all themes.
 */
export function deriveDarkVariant(lightHex: string): string {
  const hsl = hexToHsl(lightHex)
  if (hsl === undefined) return NEUTRAL_TONE.dark
  return hslToHex({ h: hsl.h, s: clamp(hsl.s * 0.32, 14, 42), l: clamp(hsl.l * 0.32, 20, 34) })
}

/**
 * Derive a readable accent (label/dot/border colour) from a surface colour:
 * darker than the surface on light themes, lighter on dark themes.
 */
export function deriveAccent(surfaceHex: string, theme: 'light' | 'dark'): string {
  const hsl = hexToHsl(surfaceHex)
  if (hsl === undefined) return theme === 'dark' ? '#c8cdd6' : '#565b66'
  return theme === 'dark'
    ? hslToHex({ h: hsl.h, s: clamp(hsl.s * 0.72, 12, 72), l: 78 })
    : hslToHex({ h: hsl.h, s: clamp(hsl.s * 0.8, 10, 62), l: 36 })
}

// ---------------------------------------------------------------------------
// Stable hashing
// ---------------------------------------------------------------------------

/** FNV-1a over UTF-16 code units: stable across sessions and machines. */
export function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/** Stable family for a task/project id. */
export function toneForId(id: string): CardTone {
  return CARD_TONES[stableHash(id) % CARD_TONES.length]!
}

/**
 * Category nuance inside a priority family.
 *
 * Offsets are bounded (ΔL ≤ 3.5 %, ΔS ≤ 5 %, ΔH ≤ 3°) and derived from the
 * category id hash, so the priority family is always recognisable while two
 * categories still read differently. "general" (and any empty id) keeps the
 * canonical base colour.
 */
export function nuanceColor(baseHex: string, categoryId: string | undefined, theme: 'light' | 'dark'): string {
  const hsl = hexToHsl(baseHex)
  if (hsl === undefined) return baseHex
  if (categoryId === undefined || categoryId.length === 0 || categoryId === GENERAL_CATEGORY_ID) return baseHex
  const hash = stableHash(categoryId)
  const step = (bits: number): number => ((hash >>> bits) % 5) - 2 // -2..2
  const hueShift = step(0) * 1.5
  const satShift = step(4) * 2.5
  const lightShift = step(8) * 1.25
  return hslToHex({
    h: hsl.h + hueShift,
    s: clamp(hsl.s + satShift, theme === 'dark' ? 18 : 38, theme === 'dark' ? 44 : 96),
    l: clamp(hsl.l + lightShift, theme === 'dark' ? 22 : 76, theme === 'dark' ? 34 : 93),
  })
}

/** Pairwise RGB distance, used to keep the three priority families distinct. */
export function colorDistance(a: string, b: string): number {
  const first = asHex(a)
  const second = asHex(b)
  if (first === undefined || second === undefined) return Number.POSITIVE_INFINITY
  const channels = (hex: string): number[] => [
    Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16),
  ]
  const [ar, ag, ab] = channels(first)
  const [br, bg, bb] = channels(second)
  return Math.sqrt((ar! - br!) ** 2 + (ag! - bg!) ** 2 + (ab! - bb!) ** 2)
}

/**
 * A custom priority colour is accepted only when it stays clearly different
 * from the other two families; otherwise the caller refuses it with an explicit
 * message instead of silently producing an ambiguous board.
 */
export function isDistinctPriorityColor(
  urgency: Urgency,
  candidate: string,
  others: Readonly<Partial<Record<Urgency, string>>>,
): boolean {
  return Object.entries(others).every(([otherUrgency, otherColor]) =>
    otherUrgency === urgency || otherColor === undefined
      || colorDistance(candidate, otherColor) >= MIN_PRIORITY_DISTANCE)
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/** Input the cards pass to the resolver. */
export interface ResolveTaskColorInput {
  task: Pick<TaskRecord, 'id' | 'workspaceId' | 'urgency' | 'category'>
  categories: readonly TaskCategory[]
  preferences: ColorPreferences
}

/** Priority surface for one urgency (custom colour wins, dark derived). */
export function prioritySurface(urgency: Urgency, preferences: ColorPreferences): { light: string; dark: string } {
  const custom = asHex(preferences.priorityColors[urgency])
  if (custom === undefined) return PRIORITY_PALETTE[urgency]
  return { light: custom, dark: deriveDarkVariant(custom) }
}

/**
 * Resolve the full render colour of one card.
 *
 * Determinism: identical inputs always produce identical strings; nothing here
 * reads the DOM, state, time, locale or list order.
 */
export function resolveTaskColor(input: ResolveTaskColorInput): ResolvedCardColor {
  const { task, categories, preferences } = input
  const category = categoryOf(categories, task.category)
  const unclassified = task.category === undefined
    || task.category === GENERAL_CATEGORY_ID
    || !categories.some(entry => entry.id === task.category)
  const mode = preferences.colorMode

  if (mode === 'card' || mode === 'project') {
    const key = mode === 'card' ? task.id : task.workspaceId
    const override = mode === 'card' ? preferences.tones[task.id] : preferences.projectColors[task.workspaceId]
    const tone = override ?? toneForId(key)
    const palette = TONE_PALETTE[tone]
    return {
      mode,
      background: lightDark(palette.light, palette.dark),
      accent: lightDark(deriveAccent(palette.light, 'light'), deriveAccent(palette.light, 'dark')),
      tone,
      category,
      unclassified,
    }
  }

  if (mode === 'category') {
    if (unclassified) {
      return {
        mode,
        background: lightDark(NEUTRAL_TONE.light, NEUTRAL_TONE.dark),
        accent: lightDark(deriveAccent(NEUTRAL_TONE.light, 'light'), deriveAccent(NEUTRAL_TONE.light, 'dark')),
        category,
        unclassified,
      }
    }
    const lightSurface = category.color
    const darkSurface = deriveDarkVariant(category.color)
    return {
      mode,
      background: lightDark(lightSurface, darkSurface),
      accent: lightDark(deriveAccent(category.color, 'light'), deriveAccent(category.color, 'dark')),
      category,
      unclassified,
    }
  }

  // mode === 'priority'
  const base = prioritySurface(task.urgency, preferences)
  const nuance = preferences.priorityNuance && !unclassified
  const lightSurface = nuance ? nuanceColor(base.light, task.category, 'light') : base.light
  const darkSurface = nuance ? nuanceColor(base.dark, task.category, 'dark') : base.dark
  return {
    mode,
    background: lightDark(lightSurface, darkSurface),
    accent: lightDark(deriveAccent(base.light, 'light'), deriveAccent(base.light, 'dark')),
    category,
    unclassified,
  }
}

/** The family the priority surface belongs to, exposed for tests and docs. */
export function priorityFamilyOf(color: string): Urgency | undefined {
  const hsl = hexToHsl(color)
  if (hsl === undefined) return undefined
  // Hue bands of the three reference families (coral ≈ 353°, violet ≈ 262°,
  // blue ≈ 212°); the ±3° nuance and the derived dark variants stay well inside.
  const hue = ((hsl.h % 360) + 360) % 360
  if (hue >= 335 || hue < 20) return 'urgent'
  if (hue >= 235 && hue < 290) return 'normal'
  if (hue >= 190 && hue < 235) return 'relaxed'
  return undefined
}

