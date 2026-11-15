/**
 * Live preview of the four colour modes (Settings → Appearance).
 *
 * Renders six fictional cards through the SAME resolver the board uses, so the
 * preview can never drift from the real rendering. The cards are non
 * interactive (`aria-hidden` on the grid, one accessible summary instead) and
 * reuse the board card classes, which keeps the surface, badges and density
 * rules identical without duplicating CSS.
 *
 * @module dsh-taskboard/client/board/ColorPreview
 */
import type { CSSProperties } from 'react'
import type { Urgency } from '../../shared/protocol.ts'
import type { TaskCategory } from '../../shared/categories.ts'
import { URGENCY_KEYS } from './labels.ts'
import { useT } from '../i18n/runtime.ts'
import { Icon } from './Icon.tsx'
import { resolveTaskColor, type ColorIntensity, type ColorMode } from './coloring.ts'
import { INTENSITY_VIBRANCY } from './coloring.ts'
import type { AppearancePrefs } from './appearance.ts'

/** One fictional sample: urgent × development, normal × bug, … */
interface PreviewSample {
  id: string
  titleKey: string
  urgency: Urgency
  categoryId?: string
}

/** Six samples covering the three priorities and three distinct categories. */
const SAMPLES: readonly PreviewSample[] = [
  { id: 'preview-1', titleKey: 'set.color.preview.title1', urgency: 'urgent', categoryId: 'development' },
  { id: 'preview-2', titleKey: 'set.color.preview.title2', urgency: 'urgent', categoryId: 'bug' },
  { id: 'preview-3', titleKey: 'set.color.preview.title3', urgency: 'normal', categoryId: 'documentation' },
  { id: 'preview-4', titleKey: 'set.color.preview.title4', urgency: 'normal', categoryId: 'design' },
  { id: 'preview-5', titleKey: 'set.color.preview.title5', urgency: 'relaxed', categoryId: 'tests' },
  { id: 'preview-6', titleKey: 'set.color.preview.title6', urgency: 'relaxed' },
]

/**
 * Preview grid.
 * @param prefs - current appearance preferences (mode + intensity + overrides).
 * @param categories - the board categories (same list the real cards resolve).
 */
export function ColorModePreview({
  prefs,
  categories,
}: {
  prefs: AppearancePrefs
  categories: readonly TaskCategory[]
}) {
  const t = useT()
  const intensity: ColorIntensity = prefs.intensity
  const mode: ColorMode = prefs.colorMode

  return (
    <div className="dsh-atb-preview">
      <div className="dsh-atb-preview-head">
        <span className="dsh-atb-setting-label">{t('set.color.preview')}</span>
        <span className="dsh-atb-setting-value">{t(`set.color.mode.${mode}`)}</span>
      </div>
      <div
        className="dsh-atb-preview-grid"
        data-atb-vibrancy={intensity}
        style={{ '--atb-vibrancy': INTENSITY_VIBRANCY[intensity] } as CSSProperties}
        role="img"
        aria-label={t('set.color.preview.aria', { mode: t(`set.color.mode.${mode}`) })}
      >
        {SAMPLES.map(sample => {
          const color = resolveTaskColor({
            task: { id: sample.id, workspaceId: 'preview-workspace', urgency: sample.urgency, category: sample.categoryId },
            categories,
            preferences: prefs,
          })
          const categoryName = color.unclassified ? t('category.unclassified') : color.category.name
          return (
            <div
              key={sample.id}
              className="dsh-atb-card dsh-atb-preview-card"
              data-tone={color.tone}
              data-urgency={sample.urgency}
              style={{ '--atb-card-bg': color.background, '--atb-tone-accent': color.accent } as CSSProperties}
            >
              <div className="dsh-atb-card-top">
                <span className="dsh-atb-card-project">
                  <span className="dsh-atb-card-tone-dot" aria-hidden="true" />
                  <span className="dsh-atb-card-project-name">{t('set.color.preview.project')}</span>
                </span>
                <span className="dsh-atb-card-id">{sample.id}</span>
              </div>
              <div className="dsh-atb-card-title">{t(sample.titleKey)}</div>
              <div className="dsh-atb-card-divider" />
              <div className="dsh-atb-card-bottom">
                <span className="dsh-atb-card-category">
                  <span className="dsh-atb-card-category-dot" aria-hidden="true" />
                  <span className="dsh-atb-card-category-name">{categoryName}</span>
                </span>
                <span className="dsh-atb-card-priority" data-urgency={sample.urgency}>
                  {sample.urgency === 'urgent'
                    ? <Icon name="warning" size={11} />
                    : <span className="dsh-atb-dot" data-urgency={sample.urgency} aria-hidden="true" />}
                  {t(URGENCY_KEYS[sample.urgency])}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
