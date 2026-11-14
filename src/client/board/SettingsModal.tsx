/**
 * Board-settings modal (0.5.0): the user-owned defaults applied when a NEW
 * task is created without an explicit choice, plus the host data-directory
 * migration surface. Saving goes through host routes and
 * the SSE change stream refreshes every open view. The interface language
 * preference applies immediately and is saved in the current browser.
 *
 * @module dsh-taskboard/client/board/SettingsModal
 */
import { useEffect, useState } from 'react'
import { ExternalSyncPanel } from './ExternalSyncPanel.tsx'
import { Select } from './Select.tsx'
import type { BoardController } from '../controller.ts'
import type { CatalogModelItem, CatalogPresetItem } from '../../shared/api.ts'
import { BRANCH_NAME_MODES, DEFAULT_BRANCH_NAME_PREFIX, DEFAULT_COMPLETED_DISPLAY_LIMIT, DEFAULT_DISPATCH_INTERVAL_MS, DEFAULT_ISOLATION, DEFAULT_MAX_CONCURRENT, DEFAULT_QUEUE_MAX_AGE_MINUTES, DEFAULT_SCHEDULE_MISSED_AFTER_MINUTES, MIN_COMPLETED_DISPLAY_LIMIT, MAX_COMPLETED_DISPLAY_LIMIT, allowClaimFromLinkedRootsOf, branchNameModeOf, branchNamePrefixOf, buildBranchName, completedDisplayLimitOf, defaultPermissionOf, defaultSyncExternalSessionsOf, dispatchIntervalMsOf, maxConcurrentOf, queueMaxAgeMinutesOf, scheduleMissedAfterMinutesOf, type BranchNameMode, type IsolationMode, type PermissionMode } from '../../shared/protocol.ts'
import { localeStore, setLocalePreference, useT, type LocalePreference, type Translate } from '../i18n/runtime.ts'
import { Icon } from './Icon.tsx'
import { CategoryManager } from './CategoryManager.tsx'
import { ColorModePreview } from './ColorPreview.tsx'
import { runClassification } from './classify.ts'
import { URGENCY_KEYS } from './labels.ts'
import {
  DENSITIES,
  clearPriorityColors,
  clearProjectColors,
  clearTaskTones,
  hashTone,
  setAppearance,
  setPriorityColor,
  setProjectTone,
  useAppearance,
  type CardTone,
} from './appearance.ts'
import {
  CARD_TONES,
  COLOR_INTENSITIES,
  COLOR_MODES,
  PRIORITY_PALETTE,
  asHex,
  isDistinctPriorityColor,
} from './coloring.ts'
import {
  categoriesOf,
  categoryLabelMapOf,
  type BoardSettings,
  type Urgency,
} from '../../shared/protocol.ts'
import { DEFAULT_CATEGORY_LABEL_MAP, asCategoryLabelMap, asTaskCategories, type TaskCategory } from '../../shared/categories.ts'

/** Effective light-theme reference colour for a priority (custom or factory). */
function effectivePriorityColor(prefs: { priorityColors: Partial<Record<Urgency, string>> }, urgency: Urgency): string {
  return prefs.priorityColors[urgency] ?? PRIORITY_PALETTE[urgency].light
}

/** Render a label map as the editable `label = categoryId` text. */
function formatLabelMap(map: Record<string, string>): string {
  const custom = Object.entries(map).filter(([label]) => !(label in DEFAULT_CATEGORY_LABEL_MAP))
  const merged = [...custom, ...Object.entries(DEFAULT_CATEGORY_LABEL_MAP)]
  return merged.map(([label, categoryId]) => `${label} = ${categoryId}`).join('\n')
}

/**
 * Parse the label-map editor. Lines are `label = categoryId` (or `label:`);
 * blank lines and `#` comments are ignored, unknown categories are refused
 * with the offending line so the user sees why nothing was saved.
 */
function parseLabelMap(text: string, categories: readonly TaskCategory[]): { map?: Record<string, string>; error?: string } {
  const known = new Set(categories.map(category => category.id))
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const match = /^(.+?)\s*(?:=|:)\s*([a-z0-9-]+)$/i.exec(line)
    if (match === null) return { error: `Ligne invalide : "${line}" (attendu : libellé = id-de-catégorie)` }
    const label = match[1]!.trim().toLowerCase()
    const categoryId = match[2]!.trim().toLowerCase()
    if (!known.has(categoryId)) return { error: `Catégorie inconnue "${categoryId}" (${line})` }
    out[label] = categoryId
  }
  return { map: out }
}

/** The isolation options with one-line hints (mirrors the task form; translated per render). */
const isolationOptions = (t: Translate): ReadonlyArray<{ value: IsolationMode; name: string; hint: string }> => [
  { value: 'none', name: t('form.iso.none'), hint: t('set.iso.noneHint') },
  { value: 'worktree', name: t('form.iso.worktree'), hint: t('set.iso.worktreeHint') },
]

/** The branch naming presets (issue #98); translated per render. */
const branchModeOptions = (t: Translate): ReadonlyArray<{ value: BranchNameMode; name: string }> => BRANCH_NAME_MODES.map(value => ({
  value,
  name: t(`set.iso.branchMode.${value}`),
}))

/** Whether the preset needs the prefix input rendered. */
const isPrefixMode = (m: BranchNameMode): boolean => m === 'prefix-id' || m === 'prefix-title-id'

/** Fixed sample task for the live naming preview (matches the hint copy). */
const PREVIEW_TITLE = '修复登录'
const PREVIEW_ID = 't-1a2b'

/**
 * The 看板设置 modal: reads the live ledger settings, stages a local draft,
 * and writes back through the controller on save.
 * @param controller - the board controller.
 */
export function SettingsModal({ controller }: { controller: BoardController }) {
  const t = useT()
  const appearance = useAppearance()
  const localePreference = localeStore.getSnapshot().preference
  const [section, setSection] = useState<'general' | 'appearance' | 'external'>('general')
  const state = controller.getSnapshot()
  // Categories and the external label mapping are shared user data living in
  // the board settings; every write goes through the whole-object settings
  // route, so it is merged with the current settings here.
  const categories = categoriesOf(state.ledger.settings)
  const categoryLabelMap = categoryLabelMapOf(state.ledger.settings)
  const [labelMapDraft, setLabelMapDraft] = useState(() => formatLabelMap(categoryLabelMap))
  const [labelMapError, setLabelMapError] = useState<string | undefined>()
  const [priorityError, setPriorityError] = useState<string | undefined>()
  const [classifyProgress, setClassifyProgress] = useState<{ done: number; total: number } | undefined>()

  /** Run the explicit migration of unclassified historical tasks. */
  const classifyExisting = (): void => {
    if (classifyProgress !== undefined) return
    setClassifyProgress({ done: 0, total: 0 })
    void runClassification(controller, {
      categories: categoriesOf(controller.getSnapshot().ledger.settings),
      labelMap: categoryLabelMapOf(controller.getSnapshot().ledger.settings),
      onProgress: (done, total) => setClassifyProgress({ done, total }),
    }).then(result => {
      setClassifyProgress(undefined)
      setClassificationResult(
        result.classified === 0 && result.failed === 0
          ? t('classification.none')
          : t('classification.result', { classified: result.classified, failed: result.failed }),
      )
    }).catch(error => {
      setClassifyProgress(undefined)
      setClassificationResult(error instanceof Error ? error.message : String(error))
    })
  }
  const [classificationResult, setClassificationResult] = useState<string | undefined>()

  /** Merge one settings patch over the current settings and persist it. */
  const persistSettings = (patch: Partial<BoardSettings>): void => {
    const merged = { ...(state.ledger.settings ?? {}), ...patch } as Parameters<BoardController['updateSettings']>[0]
    void controller.updateSettings(merged)
  }

  /** Save the `label = category` editor after validating every line. */
  const saveLabelMap = (): void => {
    const parsed = parseLabelMap(labelMapDraft, categories)
    if (parsed.map === undefined) { setLabelMapError(parsed.error); return }
    setLabelMapError(undefined)
    // Re-sanitize against the live categories and keep the factory defaults
    // unless the user overrode them explicitly.
    persistSettings({ categoryLabelMap: asCategoryLabelMap(parsed.map, categories) })
  }

  /** Apply a custom priority colour only when it stays distinct from the others. */
  const changePriorityColor = (urgency: Urgency, value: string): void => {
    const candidate = asHex(value)
    if (candidate === undefined) return
    const others: Partial<Record<Urgency, string>> = {
      urgent: effectivePriorityColor(appearance, 'urgent'),
      normal: effectivePriorityColor(appearance, 'normal'),
      relaxed: effectivePriorityColor(appearance, 'relaxed'),
    }
    delete others[urgency]
    if (!isDistinctPriorityColor(urgency, candidate, others)) {
      setPriorityError(t('set.color.priority.error'))
      return
    }
    setPriorityError(undefined)
    setPriorityColor(urgency, candidate)
  }
  const currentIso = state.ledger.settings?.defaultIsolation ?? DEFAULT_ISOLATION
  const currentSync = defaultSyncExternalSessionsOf(state.ledger.settings)
  const currentPerm = defaultPermissionOf(state.ledger.settings)
  const currentMulti = allowClaimFromLinkedRootsOf(state.ledger.settings)
  const currentMaxConcurrent = maxConcurrentOf(state.ledger.settings)
  const currentMissedAfterMinutes = scheduleMissedAfterMinutesOf(state.ledger.settings)
  const currentQueueMaxAgeMinutes = queueMaxAgeMinutesOf(state.ledger.settings)
  const currentDispatchIntervalMs = dispatchIntervalMsOf(state.ledger.settings)
  const currentCompletedLimit = completedDisplayLimitOf(state.ledger.settings)
  const currentModel = state.ledger.settings?.defaultModel
  const currentModelKey = currentModel === undefined ? '' : JSON.stringify({ provider: currentModel.provider, model: currentModel.model })
  const currentEffort = currentModel?.reasoningEffort ?? ''
  const currentPreset = state.ledger.settings?.defaultPresetId ?? ''
  const currentDefaultWorkspace = state.ledger.settings?.defaultWorkspaceId ?? ''
  const [catalog, setCatalog] = useState<CatalogModelItem[]>([])
  const [presets, setPresets] = useState<CatalogPresetItem[]>([])
  const [presetDefault, setPresetDefault] = useState<string | undefined>()
  const [draftModel, setDraftModel] = useState(currentModelKey)
  const [draftEffort, setDraftEffort] = useState(currentEffort)
  const [draftPreset, setDraftPreset] = useState(currentPreset)
  const [draftDefaultWorkspace, setDraftDefaultWorkspace] = useState(currentDefaultWorkspace)
  const parsedModel = draftModel === '' ? undefined : JSON.parse(draftModel) as { provider: string; model: string }
  const selectedModel = catalog.find(m => m.provider === parsedModel?.provider && m.model === parsedModel?.model)
  const reasoning = selectedModel?.reasoning
  const [draftIso, setDraftIso] = useState<IsolationMode>(currentIso)
  const currentBranchMode = branchNameModeOf(state.ledger.settings)
  const currentBranchPrefix = branchNamePrefixOf(state.ledger.settings)
  const [draftBranchMode, setDraftBranchMode] = useState<BranchNameMode>(currentBranchMode)
  const [draftBranchPrefix, setDraftBranchPrefix] = useState(currentBranchPrefix)
  const [draftSync, setDraftSync] = useState<boolean>(currentSync)
  const [draftPerm, setDraftPerm] = useState<PermissionMode>(currentPerm)
  const [draftMulti, setDraftMulti] = useState<boolean>(currentMulti)
  const [draftMaxConcurrent, setDraftMaxConcurrent] = useState(String(currentMaxConcurrent))
  const [draftMissedAfterMinutes, setDraftMissedAfterMinutes] = useState(String(currentMissedAfterMinutes))
  const [draftQueueMaxAgeMinutes, setDraftQueueMaxAgeMinutes] = useState(String(currentQueueMaxAgeMinutes))
  const [draftDispatchIntervalMs, setDraftDispatchIntervalMs] = useState(String(currentDispatchIntervalMs))
  const [draftCompletedLimit, setDraftCompletedLimit] = useState(String(currentCompletedLimit))
  const [storagePath, setStoragePath] = useState(state.storage?.currentDirectory ?? '')
  const [storageTouched, setStorageTouched] = useState(false)
  const [storageBusy, setStorageBusy] = useState(false)
  const maxConcurrent = Number(draftMaxConcurrent)
  const missedAfterMinutes = Number(draftMissedAfterMinutes)
  const queueMaxAgeMinutes = Number(draftQueueMaxAgeMinutes)
  const dispatchIntervalMs = Number(draftDispatchIntervalMs)
  const completedLimit = Number(draftCompletedLimit)
  const scheduleValid = Number.isSafeInteger(maxConcurrent) && maxConcurrent >= 1 && maxConcurrent <= 100
    && Number.isSafeInteger(missedAfterMinutes) && missedAfterMinutes >= 1 && missedAfterMinutes <= 1440
    && Number.isSafeInteger(queueMaxAgeMinutes) && queueMaxAgeMinutes >= 0 && queueMaxAgeMinutes <= 10080
    && Number.isSafeInteger(dispatchIntervalMs) && dispatchIntervalMs >= 0 && dispatchIntervalMs <= 60000
  const completedLimitValid = Number.isSafeInteger(completedLimit) && completedLimit >= MIN_COMPLETED_DISPLAY_LIMIT && completedLimit <= MAX_COMPLETED_DISPLAY_LIMIT
  const dirty = draftModel !== currentModelKey || draftEffort !== currentEffort || draftPreset !== currentPreset
    || draftDefaultWorkspace !== currentDefaultWorkspace
    || draftIso !== currentIso || draftSync !== currentSync || draftPerm !== currentPerm || draftMulti !== currentMulti
    || draftBranchMode !== currentBranchMode || draftBranchPrefix !== currentBranchPrefix
    || draftMaxConcurrent !== String(currentMaxConcurrent) || draftMissedAfterMinutes !== String(currentMissedAfterMinutes)
    || draftQueueMaxAgeMinutes !== String(currentQueueMaxAgeMinutes) || draftDispatchIntervalMs !== String(currentDispatchIntervalMs)
    || draftCompletedLimit !== String(currentCompletedLimit)
  const effectiveStoragePath = storagePath.trim().length === 0 ? state.storage?.defaultDirectory ?? '' : storagePath.trim()
  const storageDirty = state.storage !== undefined && effectiveStoragePath !== state.storage.currentDirectory

  useEffect(() => {
    if (!storageTouched && state.storage !== undefined) setStoragePath(state.storage.currentDirectory)
  }, [state.storage, storageTouched])

  useEffect(() => {
    let active = true
    void controller.fetchModelCatalog().then(models => { if (active) setCatalog(models) }).catch(() => {})
    void controller.fetchPresetCatalog().then(roster => {
      if (active) { setPresets(roster.presets); setPresetDefault(roster.defaultId) }
    }).catch(() => {})
    return () => { active = false }
  }, [controller])

  const save = (): void => {
    void controller.updateSettings({
      // The settings route replaces the whole object: carry the shared user
      // data this tab does not edit (categories + external label mapping) so a
      // general-settings save can never drop them.
      ...(state.ledger.settings?.categories !== undefined ? { categories: state.ledger.settings.categories } : {}),
      ...(state.ledger.settings?.categoryLabelMap !== undefined ? { categoryLabelMap: state.ledger.settings.categoryLabelMap } : {}),
      defaultIsolation: draftIso,
      branchNameMode: draftBranchMode,
      branchNamePrefix: draftBranchPrefix.trim().length === 0 ? DEFAULT_BRANCH_NAME_PREFIX : draftBranchPrefix,
      syncExternalSessions: draftSync,
      defaultPermission: draftPerm,
      allowClaimFromLinkedRoots: draftMulti,
      ...(parsedModel !== undefined ? { defaultModel: { ...parsedModel, ...(draftEffort !== '' ? { reasoningEffort: draftEffort } : {}) } } : {}),
      ...(draftPreset !== '' ? { defaultPresetId: draftPreset } : {}),
      ...(draftDefaultWorkspace !== '' ? { defaultWorkspaceId: draftDefaultWorkspace } : {}),
      maxConcurrent,
      scheduleMissedAfterMinutes: missedAfterMinutes,
      queueMaxAgeMinutes,
      dispatchIntervalMs,
      completedDisplayLimit: completedLimit,
    }).then(ok => {
      if (ok) controller.closeSettings()
    })
  }

  return (
    <div className="dsh-atb-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) controller.closeSettings() }}>
      <div className="dsh-atb-modal dsh-atb-set" role="dialog" aria-modal="true" aria-label={t('set.aria')}>
        <div className="dsh-atb-modal-head">
          <span className="dsh-atb-modal-headicon"><Icon name="settings" /></span>
          <div className="dsh-atb-modal-headtext">
            <h3>{t('set.title')}</h3>
            <p>{t('set.subtitle')}</p>
          </div>
          <button type="button" className="dsh-atb-modal-close" aria-label={t('shared.close')} onClick={() => controller.closeSettings()}><Icon name="close" /></button>
        </div>

        <div className="dsh-atb-settings-layout">
          <nav className="dsh-atb-settings-nav" role="tablist" aria-label={t('set.nav.label')} aria-orientation="vertical"
            onKeyDown={e => {
              if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
              e.preventDefault()
              const order = ['general', 'appearance', 'external'] as const
              const index = order.indexOf(section)
              const next = (e.key === 'Home' ? order[0]
                : e.key === 'End' ? order[order.length - 1]
                : e.key === 'ArrowDown' ? order[Math.min(order.length - 1, index + 1)]
                : order[Math.max(0, index - 1)])!
              setSection(next)
              e.currentTarget.querySelector<HTMLButtonElement>(`#dsh-atb-settings-tab-${next}`)?.focus()
            }}>
            {(['general', 'appearance', 'external'] as const).map(value => <button key={value} id={`dsh-atb-settings-tab-${value}`} type="button" role="tab"
              aria-selected={section === value} aria-controls={`dsh-atb-settings-panel-${value}`} tabIndex={section === value ? 0 : -1}
              onClick={() => setSection(value)}>{t(`set.nav.${value}`)}{value === 'general' && dirty ? ' •' : ''}</button>)}
          </nav>
          <div className="dsh-atb-settings-content">
        <div className="dsh-atb-modal-body" id="dsh-atb-settings-panel-general" role="tabpanel" aria-labelledby="dsh-atb-settings-tab-general" hidden={section !== 'general'}>
          <section className="dsh-atb-diag-sec">
            <label className="dsh-atb-field dsh-atb-field-inline">
              <span className="dsh-atb-field-label">{t('set.language.label')}</span>
              <Select
                full
                ariaLabel={t('set.language.label')}
                value={localePreference}
                onChange={v => setLocalePreference(v as LocalePreference)}
                options={[
                  { value: 'follow', label: t('set.language.follow') },
                  { value: 'zh', label: '简体中文' },
                  { value: 'en', label: 'English' },
                  { value: 'ru', label: 'Русский' },
                ]}
              />
            </label>
            <p id="dsh-atb-language-hint" className="dsh-atb-isolation-note">{t('set.language.hint')}</p>
          </section>
          <section className="dsh-atb-diag-sec">
            <label className="dsh-atb-field dsh-atb-field-inline">
              <span className="dsh-atb-field-label">{t('set.workspace.field')}</span>
              <Select
                full
                ariaLabel={t('set.workspace.field')}
                value={draftDefaultWorkspace}
                onChange={v => setDraftDefaultWorkspace(v)}
                options={[
                  { value: '', label: t('set.workspace.follow') },
                  ...(draftDefaultWorkspace !== '' && !(state.workspaces ?? []).some(w => w.id === draftDefaultWorkspace)
                    ? [{ value: draftDefaultWorkspace, label: draftDefaultWorkspace }]
                    : []),
                  ...(state.workspaces ?? []).map(ws => ({ value: ws.id, label: ws.title || ws.path })),
                ]}
              />
            </label>
            <p className="dsh-atb-isolation-note">{t('set.workspace.hint')}</p>
          </section>

          <section className="dsh-atb-diag-sec">
            <h4>{t('set.iso.heading')}</h4>
            <div className="dsh-atb-mode-picker">
              {isolationOptions(t).map(o => (
                <button
                  key={o.value}
                  type="button"
                  className="dsh-atb-mode-opt"
                  data-on={draftIso === o.value}
                  title={o.hint}
                  onClick={() => setDraftIso(o.value)}
                >
                  <span className="dsh-atb-mode-name">{o.name}</span>
                  <span className="dsh-atb-mode-hint">{o.hint}</span>
                </button>
              ))}
            </div>
            <span className="dsh-atb-isolation-note">
              {t('set.iso.current', { current: currentIso === 'worktree' ? t('form.iso.worktree') : t('form.iso.none') })}
            </span>
          </section>

          <section className="dsh-atb-diag-sec">
            <h4>{t('set.iso.branchHeading')}</h4>
            <p className="dsh-atb-isolation-note">{t('set.iso.branchHint')}</p>
            <label className="dsh-atb-field dsh-atb-field-inline">
              <span className="dsh-atb-field-label">{t('set.iso.branchMode.label')}</span>
              <Select
                full
                ariaLabel={t('set.iso.branchMode.label')}
                value={draftBranchMode}
                onChange={v => setDraftBranchMode(v as BranchNameMode)}
                options={branchModeOptions(t).map(o => ({ value: o.value, label: o.name }))}
              />
            </label>
            {isPrefixMode(draftBranchMode) && (
              <label className="dsh-atb-field dsh-atb-field-inline">
                <span className="dsh-atb-field-label">{t('set.iso.branchPrefix')}</span>
                <input className="dsh-atb-input" value={draftBranchPrefix} maxLength={20} spellCheck={false}
                  placeholder={DEFAULT_BRANCH_NAME_PREFIX}
                  onChange={e => setDraftBranchPrefix(e.target.value)} />
              </label>
            )}
            <span className="dsh-atb-isolation-note">
              {t('set.iso.branchExample', { example: buildBranchName(PREVIEW_TITLE, PREVIEW_ID, draftBranchMode, draftBranchPrefix.trim().length === 0 ? DEFAULT_BRANCH_NAME_PREFIX : draftBranchPrefix) })}
            </span>
          </section>

          <section className="dsh-atb-diag-sec">
            <h4>{t('set.sync.heading')}</h4>
            <div className="dsh-atb-mode-picker">
              <button
                type="button"
                className="dsh-atb-mode-opt"
                data-on={!draftSync}
                title={t('set.sync.off.title')}
                onClick={() => setDraftSync(false)}
              >
                <span className="dsh-atb-mode-name">{t('set.sync.off.name')}</span>
                <span className="dsh-atb-mode-hint">{t('set.sync.off.hint')}</span>
              </button>
              <button
                type="button"
                className="dsh-atb-mode-opt"
                data-on={draftSync}
                title={t('set.sync.on.title')}
                onClick={() => setDraftSync(true)}
              >
                <span className="dsh-atb-mode-name">{t('set.sync.on.name')}</span>
                <span className="dsh-atb-mode-hint">{t('set.sync.on.hint')}</span>
              </button>
            </div>
            <span className="dsh-atb-isolation-note">
              {currentSync
                ? t('set.sync.stateOn')
                : t('set.sync.stateOff')}
            </span>
          </section>



          <section className="dsh-atb-diag-sec">
            <h4>{t('set.multiroots.heading')}</h4>
            <p className="dsh-atb-isolation-note">{t('set.multiroots.hint')}</p>
            <div className="dsh-atb-mode-picker">
              <button
                type="button"
                className="dsh-atb-mode-opt"
                data-on={!draftMulti}
                title={t('set.multiroots.off.hint')}
                onClick={() => setDraftMulti(false)}
              >
                <span className="dsh-atb-mode-name">{t('set.multiroots.off.name')}</span>
                <span className="dsh-atb-mode-hint">{t('set.multiroots.off.hint')}</span>
              </button>
              <button
                type="button"
                className="dsh-atb-mode-opt"
                data-on={draftMulti}
                title={t('set.multiroots.on.hint')}
                onClick={() => setDraftMulti(true)}
              >
                <span className="dsh-atb-mode-name">{t('set.multiroots.on.name')}</span>
                <span className="dsh-atb-mode-hint">{t('set.multiroots.on.hint')}</span>
              </button>
            </div>
            <span className="dsh-atb-isolation-note">
              {currentMulti ? t('set.multiroots.stateOn') : t('set.multiroots.stateOff')}
            </span>
          </section>

          <section className="dsh-atb-diag-sec">
            <h4>{t('set.agent.heading')}</h4>
            <p className="dsh-atb-isolation-note">{t('set.agent.hint')}</p>
            <div className="dsh-atb-form-subgrid">
              <label className="dsh-atb-field">
                <span className="dsh-atb-field-label">{t('set.agent.model')}</span>
                <Select
                  full
                  ariaLabel={t('form.field.model')}
                  value={draftModel}
                  onChange={v => { setDraftModel(v); setDraftEffort('') }}
                  options={[
                    { value: '', label: t('form.field.modelDefault') },
                    ...(parsedModel !== undefined && selectedModel === undefined
                      ? [{ value: draftModel, label: parsedModel.model + ' (' + parsedModel.provider + ')' }]
                      : []),
                    ...catalog.map(m => ({
                      value: JSON.stringify({ provider: m.provider, model: m.model }),
                      label: t('form.model.option', { name: m.name ?? m.model, provider: m.provider }),
                    })),
                  ]}
                />
              </label>
              <label className="dsh-atb-field">
                <span className="dsh-atb-field-label">{t('set.agent.effort')}</span>
                <Select
                  full
                  ariaLabel={t('form.field.effort')}
                  disabled={parsedModel === undefined}
                  value={draftEffort}
                  onChange={v => setDraftEffort(v)}
                  options={[
                    { value: '', label: t('form.effort.follow') + (reasoning?.defaultEffort !== undefined
                      ? t('shared.current', { name: reasoning.efforts.find(e => e.id === reasoning.defaultEffort)?.name ?? reasoning.defaultEffort })
                      : '') },
                    ...(draftEffort !== '' && reasoning !== undefined && !reasoning.efforts.some(e => e.id === draftEffort)
                      ? [{ value: draftEffort, label: draftEffort }]
                      : []),
                    ...(reasoning !== undefined
                      ? reasoning.efforts.map(e => ({ value: e.id, label: e.name + (e.description ? ' (' + e.description + ')' : '') }))
                      : [
                        ...(!['', 'low', 'medium', 'high', 'none'].includes(draftEffort) ? [{ value: draftEffort, label: draftEffort }] : []),
                        { value: 'low', label: t('form.effort.low') },
                        { value: 'medium', label: t('form.effort.medium') },
                        { value: 'high', label: t('form.effort.high') },
                        { value: 'none', label: t('form.effort.none') },
                      ]),
                  ]}
                />
              </label>
              <label className="dsh-atb-field">
                <span className="dsh-atb-field-label">{t('set.agent.preset')}</span>
                <Select
                  full
                  ariaLabel={t('form.field.preset')}
                  value={draftPreset}
                  onChange={v => setDraftPreset(v)}
                  options={[
                    { value: '', label: t('form.preset.follow') + (presetDefault !== undefined
                      ? t('shared.current', { name: presets.find(p => p.id === presetDefault)?.name ?? presetDefault })
                      : '') },
                    ...(draftPreset !== '' && !presets.some(p => p.id === draftPreset) ? [{ value: draftPreset, label: draftPreset }] : []),
                    ...presets.map(p => ({ value: p.id, label: (p.name ?? p.id) + (p.id === presetDefault ? t('form.preset.defaultTag') : '') })),
                  ]}
                />
              </label>
            </div>
          </section>

          <section className="dsh-atb-diag-sec">
            <h4>{t('set.perm.heading')}</h4>
            <div className="dsh-atb-perm-picker">
              <button
                type="button"
                className="dsh-atb-perm-opt"
                data-on={draftPerm === 'workspace-write'}
                onClick={() => setDraftPerm('workspace-write')}
              >
                <span className="dsh-atb-perm-name"><Icon name="folder" /> {t('set.perm.writeName')}</span>
                <span className="dsh-atb-perm-hint">{t('set.perm.writeHint')}</span>
              </button>
              <button
                type="button"
                className="dsh-atb-perm-opt"
                data-on={draftPerm === 'read-only'}
                onClick={() => setDraftPerm('read-only')}
              >
                <span className="dsh-atb-perm-name"><Icon name="lock" /> {t('set.perm.readOnlyName')}</span>
                <span className="dsh-atb-perm-hint">{t('set.perm.readOnlyHint')}</span>
              </button>
              <button
                type="button"
                className="dsh-atb-perm-opt"
                data-on={draftPerm === 'danger-full-access'}
                onClick={() => setDraftPerm('danger-full-access')}
              >
                <span className="dsh-atb-perm-name"><Icon name="shieldCheck" /> {t('set.perm.fullName')}</span>
                <span className="dsh-atb-perm-hint">{t('set.perm.fullHint')}</span>
              </button>
            </div>
            <span className="dsh-atb-isolation-note">
              {t('set.perm.current', { current: currentPerm === 'read-only' ? t('set.perm.readOnlyName') : currentPerm === 'danger-full-access' ? t('set.perm.fullName') : t('set.perm.writeName') })}
            </span>
          </section>

          <section className="dsh-atb-diag-sec">
            <h4>{t('set.schedule.heading')}</h4>
            <p className="dsh-atb-isolation-note">{t('set.schedule.hint')}</p>
            <div className="dsh-atb-settings-numbers">
              <label>
                <span>{t('set.schedule.concurrent')}</span>
                <input className="dsh-atb-input" type="number" min="1" max="100" step="1" value={draftMaxConcurrent} onChange={e => setDraftMaxConcurrent(e.target.value)} />
              </label>
              <label>
                <span>{t('set.schedule.missedAfter')}</span>
                <input className="dsh-atb-input" type="number" min="1" max="1440" step="1" value={draftMissedAfterMinutes} onChange={e => setDraftMissedAfterMinutes(e.target.value)} />
              </label>
              <label>
                <span>{t('set.schedule.queueMaxAge')}</span>
                <input className="dsh-atb-input" type="number" min="0" max="10080" step="1" value={draftQueueMaxAgeMinutes} onChange={e => setDraftQueueMaxAgeMinutes(e.target.value)} />
              </label>
              <label>
                <span>{t('set.schedule.dispatchInterval')}</span>
                <input className="dsh-atb-input" type="number" min="0" max="60000" step="1" value={draftDispatchIntervalMs} onChange={e => setDraftDispatchIntervalMs(e.target.value)} />
              </label>
            </div>
            {!scheduleValid && <span className="dsh-atb-storage-error">{t('set.schedule.invalid')}</span>}
          </section>

          <section className="dsh-atb-diag-sec">
            <h4>{t('set.completedLimit.heading')}</h4>
            <p className="dsh-atb-isolation-note">{t('set.completedLimit.hint')}</p>
            <div className="dsh-atb-settings-numbers">
              <label>
                <span>{t('set.completedLimit.label')}</span>
                <input
                  className="dsh-atb-input"
                  type="number"
                  min={MIN_COMPLETED_DISPLAY_LIMIT}
                  max={MAX_COMPLETED_DISPLAY_LIMIT}
                  step="1"
                  value={draftCompletedLimit}
                  onChange={e => setDraftCompletedLimit(e.target.value)}
                />
              </label>
            </div>
            {!completedLimitValid && <span className="dsh-atb-storage-error">{t('set.schedule.invalid')}</span>}
          </section>

          <section className="dsh-atb-diag-sec">
            <h4>{t('set.storage.heading')}</h4>
            <p className="dsh-atb-isolation-note">{t('set.storage.hint')}</p>
            <input
              className="dsh-atb-input dsh-atb-storage-path"
              value={storagePath}
              disabled={state.storage === undefined || storageBusy}
              placeholder={state.storage?.defaultDirectory ?? t('set.storage.loading')}
              onChange={e => { setStoragePath(e.target.value); setStorageTouched(true); controller.dismissStorageNotice() }}
            />
            {state.storageNotice !== undefined && (
              <div className="dsh-atb-storage-notice" role="status">
                <span className="dsh-atb-storage-notice-ok"><Icon name="check" /> {t('set.storage.migrated', { path: state.storageNotice.path })}</span>
                {state.storageNotice.warnings.length > 0 && (
                  <span className="dsh-atb-storage-notice-warn">{t('set.storage.warnings', { warnings: state.storageNotice.warnings.join('; ') })}</span>
                )}
              </div>
            )}
            {state.storage !== undefined && (
              <div className="dsh-atb-storage-meta">
                <span>{t('set.storage.current', { path: state.storage.currentDirectory })}</span>
                <span>{t('set.storage.assets', { count: state.storage.assetCount, size: (state.storage.assetBytes / 1024 / 1024).toFixed(1) })}</span>
                {state.storage.error !== undefined && <span className="dsh-atb-storage-error">{state.storage.error}</span>}
              </div>
            )}
            <div className="dsh-atb-storage-actions">
              <button
                type="button"
                className="dsh-atb-btn"
                disabled={state.storage === undefined || storageBusy}
                onClick={() => { setStoragePath(state.storage?.defaultDirectory ?? ''); setStorageTouched(true) }}
              >
                {t('set.storage.default')}
              </button>
              <button
                type="button"
                className="dsh-atb-btn"
                disabled={state.storage === undefined || storageBusy || effectiveStoragePath.length === 0}
                onClick={() => {
                  setStorageBusy(true)
                  void controller.checkStorage(effectiveStoragePath).finally(() => setStorageBusy(false))
                }}
              >
                {t('set.storage.check')}
              </button>
              <button
                type="button"
                className="dsh-atb-btn"
                data-primary="true"
                disabled={!storageDirty || storageBusy}
                onClick={() => {
                  if (!window.confirm(t('set.storage.confirm', { from: state.storage?.currentDirectory ?? '', to: effectiveStoragePath }))) return
                  setStorageBusy(true)
                  void controller.migrateStorage(effectiveStoragePath).then(ok => {
                    if (ok) { setStorageTouched(false); setStoragePath(effectiveStoragePath) }
                  }).finally(() => setStorageBusy(false))
                }}
              >
                {storageBusy ? t('set.storage.migrating') : t('set.storage.migrate')}
              </button>
            </div>
          </section>
        </div>
        <div className="dsh-atb-modal-body" id="dsh-atb-settings-panel-appearance" role="tabpanel" aria-labelledby="dsh-atb-settings-tab-appearance" hidden={section !== 'appearance'}>
          <section className="dsh-atb-diag-sec dsh-atb-preview">
            <h4 className="dsh-atb-setting-title">{t('set.appearance.heading')}</h4>
            <p className="dsh-atb-isolation-note">{t('set.appearance.hint')}</p>

            <div className="dsh-atb-setting">
              <span className="dsh-atb-setting-label">{t('set.color.mode')}</span>
              <div className="dsh-atb-colormodes" role="group" aria-label={t('set.color.mode')}>
                {COLOR_MODES.map(mode => (
                  <button
                    key={mode}
                    type="button"
                    className="dsh-atb-colormode"
                    data-mode={mode}
                    data-on={appearance.colorMode === mode}
                    aria-pressed={appearance.colorMode === mode}
                    onClick={() => setAppearance({ colorMode: mode })}
                  >
                    <span className="dsh-atb-colormode-swatch" data-mode={mode} aria-hidden="true" />
                    <span className="dsh-atb-colormode-text">
                      <span className="dsh-atb-colormode-name">{t(`set.color.mode.${mode}`)}</span>
                      <span className="dsh-atb-colormode-hint">{t(`set.color.mode.${mode}Hint`)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="dsh-atb-setting">
              <span className="dsh-atb-setting-label">{t('set.color.intensity')}</span>
              <div className="dsh-atb-mode-picker" data-exec="true" data-picker="intensity" role="group" aria-label={t('set.color.intensity')}>
                {COLOR_INTENSITIES.map(intensity => (
                  <button
                    key={intensity}
                    type="button"
                    className="dsh-atb-mode-opt"
                    data-intensity={intensity}
                    data-on={appearance.intensity === intensity}
                    aria-pressed={appearance.intensity === intensity}
                    onClick={() => setAppearance({ intensity })}
                  >
                    <span className="dsh-atb-mode-name">{t(`set.color.intensity.${intensity}`)}</span>
                  </button>
                ))}
              </div>
              <p className="dsh-atb-setting-hint">{t('set.color.intensityHint')}</p>
            </div>

            {appearance.colorMode === 'card' && (
              <div className="dsh-atb-setting">
                <span className="dsh-atb-setting-label">{t('set.color.card.heading')}</span>
                <div className="dsh-atb-tone-palette" role="group" aria-label={t('set.color.card.heading')}>
                  {CARD_TONES.map(tone => (
                    <span key={tone} className="dsh-atb-tone-chip" data-tone={tone} title={t(`appearance.tone.${tone}`)} />
                  ))}
                </div>
                <p className="dsh-atb-setting-hint">{t('set.color.card.hint')}</p>
                <div className="dsh-atb-setting-actions">
                  <span className="dsh-atb-setting-value">{t('set.appearance.tonesCount', { n: Object.keys(appearance.tones).length })}</span>
                  <button
                    type="button"
                    className="dsh-atb-btn"
                    disabled={Object.keys(appearance.tones).length === 0}
                    onClick={() => clearTaskTones()}
                  >
                    {t('set.appearance.tonesReset')}
                  </button>
                </div>
              </div>
            )}

            {appearance.colorMode === 'project' && (
              <div className="dsh-atb-setting">
                <span className="dsh-atb-setting-label">{t('set.color.project.heading')}</span>
                <p className="dsh-atb-setting-hint">{t('set.color.project.hint')}</p>
                <ul className="dsh-atb-projectcolors">
                  {state.workspaces.length === 0 && <li className="dsh-atb-setting-value">{t('set.color.project.empty')}</li>}
                  {state.workspaces.map(workspace => {
                    const name = workspace.title?.trim() || workspace.path || workspace.id.slice(0, 8)
                    const current = appearance.projectColors[workspace.id]
                    return (
                      <li key={workspace.id} className="dsh-atb-projectcolor-row">
                        <span className="dsh-atb-projectcolor-name" title={workspace.path ?? workspace.id}>{name}</span>
                        <span className="dsh-atb-projectcolor-swatch" data-tone={current ?? hashTone(workspace.id)} aria-hidden="true" />
                        <Select
                          ariaLabel={t('set.color.project.colorFor', { name })}
                          value={current ?? ''}
                          onChange={value => setProjectTone(workspace.id, value === '' ? undefined : value as CardTone)}
                          options={[
                            { value: '', label: t('set.color.project.auto') },
                            ...CARD_TONES.map(tone => ({ value: tone, label: t(`appearance.tone.${tone}`) })),
                          ]}
                        />
                      </li>
                    )
                  })}
                </ul>
                <div className="dsh-atb-setting-actions">
                  <button
                    type="button"
                    className="dsh-atb-btn"
                    disabled={Object.keys(appearance.projectColors).length === 0}
                    onClick={() => clearProjectColors()}
                  >
                    {t('set.color.project.reset')}
                  </button>
                </div>
              </div>
            )}

            {appearance.colorMode === 'category' && (
              <div className="dsh-atb-setting">
                <span className="dsh-atb-setting-label">{t('set.color.category.heading')}</span>
                <CategoryManager categories={categories} onChange={next => persistSettings({ categories: next })} />
                <div className="dsh-atb-setting-actions">
                  <span className="dsh-atb-setting-value">
                    {t('set.color.classify.count', { classified: state.ledger.tasks.filter(task => task.category !== undefined).length, total: state.ledger.tasks.filter(task => task.trashedAt === undefined).length })}
                  </span>
                  <button
                    type="button"
                    className="dsh-atb-btn"
                    data-primary="true"
                    disabled={classifyProgress !== undefined}
                    onClick={classifyExisting}
                  >
                    {classifyProgress === undefined
                      ? t('set.color.classify.action')
                      : t('board.category.hint.classifying', { done: classifyProgress.done, total: classifyProgress.total })}
                  </button>
                </div>
                <p className="dsh-atb-setting-hint">{t('set.color.classify.hint')}</p>
                {classificationResult !== undefined && <p className="dsh-atb-setting-hint" role="status">{classificationResult}</p>}
              </div>
            )}

            {appearance.colorMode === 'priority' && (
              <div className="dsh-atb-setting">
                <span className="dsh-atb-setting-label">{t('set.color.priority.heading')}</span>
                <p className="dsh-atb-setting-hint">{t('set.color.priority.hint')}</p>
                <ul className="dsh-atb-prioritycolors">
                  {(['urgent', 'normal', 'relaxed'] as const).map(urgency => (
                    <li key={urgency} className="dsh-atb-prioritycolor-row">
                      <span className="dsh-atb-prioritycolor-name">
                        <span className="dsh-atb-dot" data-urgency={urgency} aria-hidden="true" />
                        {t(URGENCY_KEYS[urgency])}
                      </span>
                      <span className="dsh-atb-prioritycolor-swatch" style={{ background: effectivePriorityColor(appearance, urgency) }} aria-hidden="true" />
                      <input
                        type="color"
                        className="dsh-atb-cat-color"
                        aria-label={t('set.color.priority.colorFor', { urgency: t(URGENCY_KEYS[urgency]) })}
                        value={effectivePriorityColor(appearance, urgency)}
                        onChange={event => changePriorityColor(urgency, event.target.value)}
                      />
                      <button
                        type="button"
                        className="dsh-atb-btn"
                        disabled={appearance.priorityColors[urgency] === undefined}
                        onClick={() => { setPriorityError(undefined); setPriorityColor(urgency, undefined) }}
                      >
                        {t('set.color.priority.resetOne')}
                      </button>
                    </li>
                  ))}
                </ul>
                {priorityError !== undefined && <p className="dsh-atb-cat-error" role="alert">{priorityError}</p>}
                <label className="dsh-atb-switchrow">
                  <span className="dsh-atb-setting-label">{t('set.color.priority.nuance')}</span>
                  <span className="dsh-atb-switch">
                    <input
                      type="checkbox"
                      checked={appearance.priorityNuance}
                      onChange={event => setAppearance({ priorityNuance: event.target.checked })}
                    />
                    <span className="dsh-atb-switch-track" aria-hidden="true" />
                  </span>
                </label>
                <p className="dsh-atb-setting-hint">{t('set.color.priority.nuanceHint')}</p>
                <div className="dsh-atb-setting-actions">
                  <button
                    type="button"
                    className="dsh-atb-btn"
                    disabled={Object.keys(appearance.priorityColors).length === 0}
                    onClick={() => { setPriorityError(undefined); clearPriorityColors() }}
                  >
                    {t('set.color.priority.reset')}
                  </button>
                </div>
              </div>
            )}

            <div className="dsh-atb-setting">
              <span className="dsh-atb-setting-label">{t('set.appearance.density')}</span>
              <div className="dsh-atb-mode-picker" data-exec="true" data-picker="density" role="group" aria-label={t('set.appearance.density')}>
                {DENSITIES.map(density => (
                  <button
                    key={density}
                    type="button"
                    className="dsh-atb-mode-opt"
                    data-on={appearance.density === density}
                    aria-pressed={appearance.density === density}
                    onClick={() => setAppearance({ density })}
                  >
                    <span className="dsh-atb-mode-name">{t(`set.appearance.density.${density}`)}</span>
                  </button>
                ))}
              </div>
              <p className="dsh-atb-setting-hint">{t('set.appearance.densityHint')}</p>
            </div>

            <div className="dsh-atb-setting">
              <label className="dsh-atb-switchrow">
                <span className="dsh-atb-setting-label">{t('set.appearance.descriptions')}</span>
                <span className="dsh-atb-switch">
                  <input
                    type="checkbox"
                    checked={appearance.descriptions}
                    onChange={e => setAppearance({ descriptions: e.target.checked })}
                  />
                  <span className="dsh-atb-switch-track" aria-hidden="true" />
                </span>
              </label>
              <p className="dsh-atb-setting-hint">{t('set.appearance.descriptionsHint')}</p>
            </div>

            <div className="dsh-atb-setting">
              <label className="dsh-atb-switchrow">
                <span className="dsh-atb-setting-label">{t('set.appearance.group')}</span>
                <span className="dsh-atb-switch">
                  <input
                    type="checkbox"
                    checked={appearance.group}
                    onChange={e => setAppearance({ group: e.target.checked })}
                  />
                  <span className="dsh-atb-switch-track" aria-hidden="true" />
                </span>
              </label>
              <p className="dsh-atb-setting-hint">{t('set.appearance.groupHint')}</p>
            </div>

            {appearance.colorMode === 'category' && (
              <div className="dsh-atb-setting">
                <span className="dsh-atb-setting-label">{t('set.color.labels.heading')}</span>
                <p className="dsh-atb-setting-hint">{t('set.color.labels.hint')}</p>
                <textarea
                  className="dsh-atb-input dsh-atb-labels-editor"
                  rows={6}
                  spellCheck={false}
                  aria-label={t('set.color.labels.heading')}
                  value={labelMapDraft}
                  onChange={event => { setLabelMapDraft(event.target.value); setLabelMapError(undefined) }}
                />
                {labelMapError !== undefined && <p className="dsh-atb-cat-error" role="alert">{labelMapError}</p>}
                <div className="dsh-atb-setting-actions">
                  <button type="button" className="dsh-atb-btn" onClick={() => setLabelMapDraft(formatLabelMap(categoryLabelMap))}>
                    {t('set.color.labels.reload')}
                  </button>
                  <button type="button" className="dsh-atb-btn" data-primary="true" onClick={saveLabelMap}>
                    {t('set.color.labels.save')}
                  </button>
                </div>
              </div>
            )}

            <ColorModePreview prefs={appearance} categories={categories} />
          </section>
        </div>
        <div className="dsh-atb-modal-body" id="dsh-atb-settings-panel-external" role="tabpanel" aria-labelledby="dsh-atb-settings-tab-external" hidden={section !== 'external'}>
          <ExternalSyncPanel />
        </div>

        {section === 'general' && <div className="dsh-atb-modal-foot">
          <span className="dsh-atb-modal-hint">{dirty ? t('set.foot.dirty') : t('set.foot.clean')}</span>
          <span className="dsh-atb-modal-footbtns">
            <button type="button" className="dsh-atb-btn" onClick={() => controller.closeSettings()}>{t('shared.cancel')}</button>
            <button type="button" className="dsh-atb-btn" data-primary="true" disabled={!dirty || !scheduleValid || !completedLimitValid} onClick={save}>{t('set.action.save')}</button>
          </span>
        </div>}
          </div>
        </div>
      </div>
    </div>
  )
}



