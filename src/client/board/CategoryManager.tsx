/**
 * Category manager (Settings → Appearance → "Par catégorie").
 *
 * Categories are shared user data persisted in the board settings, so every
 * mutation is a whole-object settings write (the host route replaces settings).
 * The manager never touches tasks: renaming a category rewrites only its
 * display name, and deleting one leaves the tasks in place — their stored id
 * simply stops resolving and they render as "Général / Non classé".
 *
 * @module dsh-taskboard/client/board/CategoryManager
 */
import { useState } from 'react'
import {
  GENERAL_CATEGORY_ID,
  MAX_CATEGORIES,
  MAX_CATEGORY_NAME,
  slugifyCategoryId,
  type TaskCategory,
} from '../../shared/categories.ts'
import { useT } from '../i18n/runtime.ts'
import { Icon } from './Icon.tsx'

/** Default colours for newly added categories (same families as the palette). */
const NEW_COLORS = ['#a9c8f2', '#c5b2ef', '#9ed9c6', '#f2c09d', '#f1abb4', '#eadd95', '#d6a6c5', '#a4d6dc']

/** One editable category row. */
function CategoryRow({
  category,
  index,
  total,
  onPatch,
  onMove,
  onRemove,
}: {
  category: TaskCategory
  index: number
  total: number
  onPatch: (patch: Partial<TaskCategory>) => void
  onMove: (delta: number) => void
  onRemove: () => void
}) {
  const t = useT()
  const [name, setName] = useState(category.name)
  const [error, setError] = useState<string | undefined>()
  const protectedGeneral = category.id === GENERAL_CATEGORY_ID

  const commitName = (): void => {
    const next = name.trim()
    if (next.length === 0) {
      setError(t('category.error.nameRequired'))
      setName(category.name)
      return
    }
    if (next.length > MAX_CATEGORY_NAME) {
      setError(t('category.error.nameTooLong', { max: MAX_CATEGORY_NAME }))
      setName(category.name)
      return
    }
    setError(undefined)
    if (next !== category.name) onPatch({ name: next })
  }

  return (
    <li className="dsh-atb-cat-row">
      <input
        type="color"
        className="dsh-atb-cat-color"
        value={category.color}
        aria-label={t('category.color', { name: category.name })}
        title={t('category.color', { name: category.name })}
        onChange={event => onPatch({ color: event.target.value })}
      />
      <input
        className="dsh-atb-input dsh-atb-cat-name"
        value={name}
        maxLength={MAX_CATEGORY_NAME}
        aria-label={t('category.name', { name: category.name })}
        aria-invalid={error === undefined ? undefined : true}
        onChange={event => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); commitName() }
          if (event.key === 'Escape') { setName(category.name); setError(undefined) }
        }}
      />
      <span className="dsh-atb-cat-id">{category.id}</span>
      <span className="dsh-atb-cat-actions">
        <button
          type="button"
          className="dsh-atb-iconbtn"
          aria-label={t('category.moveUp', { name: category.name })}
          title={t('category.moveUp', { name: category.name })}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        ><Icon name="chevronDown" size={12} /></button>
        <button
          type="button"
          className="dsh-atb-iconbtn"
          aria-label={t('category.moveDown', { name: category.name })}
          title={t('category.moveDown', { name: category.name })}
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        ><Icon name="chevronDown" size={12} /></button>
        <button
          type="button"
          className="dsh-atb-iconbtn"
          data-danger="true"
          aria-label={t('category.remove', { name: category.name })}
          title={protectedGeneral ? t('category.removeProtected') : t('category.remove', { name: category.name })}
          disabled={protectedGeneral}
          onClick={onRemove}
        ><Icon name="trash" size={12} /></button>
      </span>
      {error !== undefined && <span className="dsh-atb-cat-error" role="alert">{error}</span>}
    </li>
  )
}

/**
 * The category manager.
 * @param categories - the current categories (from the board settings).
 * @param onChange - persist the next full list.
 */
export function CategoryManager({
  categories,
  onChange,
}: {
  categories: readonly TaskCategory[]
  onChange: (next: TaskCategory[]) => void
}) {
  const t = useT()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>()

  const patchCategory = (id: string, patch: Partial<TaskCategory>): void => {
    onChange(categories.map(category => category.id === id ? { ...category, ...patch } : category))
  }

  const moveCategory = (id: string, delta: number): void => {
    const index = categories.findIndex(category => category.id === id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= categories.length) return
    const next = [...categories]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved!)
    onChange(next.map((category, order) => ({ ...category, order })))
  }

  const removeCategory = (id: string): void => {
    if (id === GENERAL_CATEGORY_ID) return
    onChange(categories.filter(category => category.id !== id).map((category, order) => ({ ...category, order })))
  }

  const addCategory = (): void => {
    const trimmed = name.trim()
    if (trimmed.length === 0) { setError(t('category.error.nameRequired')); return }
    if (categories.length >= MAX_CATEGORIES) { setError(t('category.error.tooMany', { max: MAX_CATEGORIES })); return }
    const base = slugifyCategoryId(trimmed)
    if (base.length === 0) { setError(t('category.error.invalidName')); return }
    let id = base
    let suffix = 2
    while (categories.some(category => category.id === id)) id = `${base.slice(0, 36)}-${suffix++}`
    const color = NEW_COLORS[categories.length % NEW_COLORS.length]!
    setError(undefined)
    setName('')
    onChange([...categories, { id, name: trimmed, color, order: categories.length }])
  }

  return (
    <div className="dsh-atb-cat-manager">
      <ul className="dsh-atb-cat-list">
        {categories.map((category, index) => (
          <CategoryRow
            key={category.id}
            category={category}
            index={index}
            total={categories.length}
            onPatch={patch => patchCategory(category.id, patch)}
            onMove={delta => moveCategory(category.id, delta)}
            onRemove={() => removeCategory(category.id)}
          />
        ))}
      </ul>
      <div className="dsh-atb-cat-add">
        <input
          className="dsh-atb-input"
          value={name}
          maxLength={MAX_CATEGORY_NAME}
          placeholder={t('category.addPlaceholder')}
          aria-label={t('category.addLabel')}
          onChange={event => { setName(event.target.value); setError(undefined) }}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCategory() } }}
        />
        <button type="button" className="dsh-atb-btn" onClick={addCategory}>
          <Icon name="plus" /> {t('category.add')}
        </button>
      </div>
      {error !== undefined && <p className="dsh-atb-cat-error" role="alert">{error}</p>}
      <p className="dsh-atb-setting-hint">{t('category.hint')}</p>
    </div>
  )
}
