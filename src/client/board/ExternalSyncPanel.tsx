import { useEffect, useState } from 'react'
import { useT } from '../i18n/runtime.ts'
import { Select } from './Select.tsx'
import { adapterDirectionsOf, adapterOperationsOf, DEFAULT_SYNC_INTERVAL_MINUTES } from '../../shared/external.ts'
import type {
  ExternalConnection,
  ExternalConnectionState,
  ExternalProject,
  ExternalSyncStatus,
  ProviderDescriptor,
} from '../../shared/external.ts'
import type { WorkspaceView } from '../../shared/api.ts'
import { externalRequest, externalTypeLabel } from '../external-api.ts'

type Status = ExternalSyncStatus
type Translate = ReturnType<typeof useT>

/**
 * Translate one capability vocabulary token (adapter kind, operation, event
 * source). Unknown tokens fall back to their raw id so a newer host can add a
 * capability without the board inventing a label — and without ever showing
 * a capability the descriptor did not declare.
 */
function capabilityLabel(t: Translate, prefix: string, id: string): string {
  const key = `${prefix}${id}`
  const label = t(key)
  return label === key ? id : label
}

/** Display name of a connection: explicit label, else the provider name. */
function connectionName(connection: ExternalConnection, providers: readonly ProviderDescriptor[] | undefined): string {
  return connection.label ?? providers?.find(provider => provider.id === connection.provider)?.name ?? connection.provider
}

/**
 * Outbound writes are opt-in AND adapter-declared: an adapter must expose the
 * `outbound` direction and the legacy `write` gate before the consent block is
 * offered at all. A read-only descriptor can therefore never be saved as
 * bidirectional from this UI.
 */
function canWriteProvider(provider: ProviderDescriptor | undefined): boolean {
  return provider !== undefined && provider.capabilities.write === true && adapterDirectionsOf(provider).includes('outbound')
}

/** Themed scope picker (provider-discovered projects + manual ID entry). */
function ScopePicker({ value, projects, loaded, onChange, t, ariaLabel }: { value: string; projects: ExternalProject[]; loaded: boolean; onChange: (value: string) => void; t: (key: string) => string; ariaLabel: string }) {
  const [manual, setManual] = useState(false)
  return <>
    <Select
      full
      ariaLabel={ariaLabel}
      title={projects.find(p => p.id === value)?.name}
      value={manual ? '__manual__' : value}
      onChange={v => {
        if (v === '__manual__') setManual(true)
        else { setManual(false); onChange(v) }
      }}
      options={[
        { value: '', label: projects.length ? t('ext.chooseScope') : t(loaded ? 'ext.noScopes' : 'ext.syncListFirst') },
        ...(value !== '' && !projects.some(p => p.id === value) ? [{ value, label: 'ID: ' + value }] : []),
        ...projects.map(p => ({ value: p.id, label: 'ID: ' + p.id + ' · ' + p.name })),
        { value: '__manual__', label: t('ext.enterScopeId') },
      ]}
    />
    {(manual || !projects.length) && <input aria-label={t('ext.enterScopeId')} value={value} onChange={e => onChange(e.target.value)} />}
  </>
}

/** One row of the connection manager. */
function ConnectionRow({ connection, provider, state, disabled, running, t, onEdit, onToggle, onSync, onRemove }: {
  connection: ExternalConnection
  provider: ProviderDescriptor | undefined
  state: ExternalConnectionState | undefined
  /** Any sync/action currently in flight (all rows are frozen). */
  disabled: boolean
  /** This very connection is being synchronized. */
  running: boolean
  t: Translate
  onEdit: () => void
  onToggle: () => void
  onSync: () => void
  onRemove: () => void
}) {
  const name = connectionName(connection, provider === undefined ? undefined : [provider])
  const enabled = connection.enabled !== false
  const hasId = connection.id !== undefined && connection.id !== ''
  const lastResult = state?.lastResult
  return <div className="dsh-atb-external-connection" role="listitem" data-connection-id={connection.id} data-enabled={enabled}>
    <div className="dsh-atb-external-conn-info">
      <b className="dsh-atb-external-conn-name">{name}</b>
      <span className="dsh-atb-external-conn-badge" data-state={enabled ? 'enabled' : 'disabled'}>{t(enabled ? 'ext.conn.enabled' : 'ext.conn.disabled')}</span>
      <span className="dsh-atb-external-conn-provider">{provider?.name ?? connection.provider} · {connection.account}</span>
    </div>
    <div className="dsh-atb-external-conn-state" role="status">
      {running
        ? t('ext.conn.running')
        : lastResult !== undefined
          ? t('ext.conn.lastSync', { at: new Date(lastResult.at).toLocaleString() })
          : state?.requiresMappingReview === true
            ? t('ext.conn.mappingReview')
            : t('ext.conn.neverSync')}
      {state !== undefined && state.ignoredCount > 0 && <> · {t('ext.conn.ignored', { count: state.ignoredCount })}</>}
    </div>
    {state?.lastError !== undefined && <p className="dsh-atb-external-conn-error" role="alert">{t('ext.conn.error')}: {state.lastError}</p>}
    <div className="dsh-atb-external-conn-actions">
      <button type="button" data-action="edit" aria-label={`${t('ext.conn.edit')}: ${name}`} disabled={disabled} onClick={onEdit}>{t('ext.conn.edit')}</button>
      <button type="button" data-action="toggle" aria-pressed={enabled} aria-label={`${t(enabled ? 'ext.conn.disable' : 'ext.conn.enable')}: ${name}`}
        disabled={disabled || !hasId} onClick={onToggle}>{t(enabled ? 'ext.conn.disable' : 'ext.conn.enable')}</button>
      <button type="button" data-action="sync" aria-label={`${t('ext.conn.sync')}: ${name}`} disabled={disabled || running} onClick={onSync}>{t('ext.conn.sync')}</button>
      <button type="button" data-action="remove" aria-label={`${t('ext.conn.remove')}: ${name}`} disabled={disabled || !hasId} onClick={onRemove}>{t('ext.conn.remove')}</button>
    </div>
  </div>
}

export function ExternalSyncPanel() {
  const t = useT()
  const [status, setStatus] = useState<Status>()
  const [baseUrl, setBaseUrl] = useState('')
  const [account, setAccount] = useState('')
  const [reuseLogin, setReuseLogin] = useState(true)
  const [providerId, setProviderId] = useState('')
  const [authMode, setAuthMode] = useState('')
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [itemTypes, setItemTypes] = useState<string[]>([])
  const [projects, setProjects] = useState<ExternalProject[]>([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [since, setSince] = useState('')
  const [interval, setIntervalMinutes] = useState(String(DEFAULT_SYNC_INTERVAL_MINUTES))
  const [mappingMode, setMappingMode] = useState<'project' | 'execution'>('project')
  const [includeUnmapped, setIncludeUnmapped] = useState(false)
  const [importStatus, setImportStatus] = useState<'backlog' | 'todo'>('backlog')
  const [assigneeFilter, setAssigneeFilter] = useState(false)
  const [matchExisting, setMatchExisting] = useState(false)
  const [direction, setDirection] = useState<'inbound' | 'bidirectional'>('inbound')
  const [mappings, setMappings] = useState<Array<{ projectId: string; workspaceId: string }>>([{ projectId: '', workspaceId: '' }])
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([])
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState('')
  const [actingOn, setActingOn] = useState<string>()
  const [message, setMessage] = useState('')
  const [savedDraft, setSavedDraft] = useState<string>()
  /** Connection currently loaded in the form; undefined while creating one. */
  const [editingId, setEditingId] = useState<string>()
  /** True when the form creates a new connection instead of updating one. */
  const [createNew, setCreateNew] = useState(false)

  const descriptor = status?.providers?.find(p => p.id === providerId)
  // Contract v1 exposes every connection; older hosts only return the primary.
  const connections = status?.connections ?? (status?.config !== undefined ? [status.config] : [])
  const connectionStates = status?.connectionStates ?? {}
  const stateOf = (connection: ExternalConnection): ExternalConnectionState | undefined => {
    const declared = connection.id !== undefined ? connectionStates[connection.id] : undefined
    if (declared !== undefined) return declared
    const legacy = status?.config
    if (legacy === undefined) return undefined
    if (connection.id !== undefined && legacy.id !== undefined && connection.id !== legacy.id) return undefined
    return { running: status?.running === true, ignoredCount: status?.ignoredCount ?? 0,
      ...(status?.lastResult !== undefined ? { lastResult: status.lastResult } : {}),
      ...(status?.lastError !== undefined ? { lastError: status.lastError } : {}),
      ...(status?.lastAttemptAt !== undefined ? { lastAttemptAt: status.lastAttemptAt } : {}),
      ...(status?.requiresMappingReview !== undefined ? { requiresMappingReview: status.requiresMappingReview } : {}) }
  }
  const anyRunning = status?.running === true || Object.values(connectionStates).some(state => state.running)
  const frozen = busy || anyRunning
  const editing = editingId !== undefined ? connections.find(connection => connection.id === editingId) : undefined
  // A new connection always starts empty: it cannot inherit the primary credentials.
  const knownConnection = createNew ? undefined : editingId === undefined ? status?.config : editing
  const isPrimaryEditing = connections[0] === undefined
    ? editingId === undefined
    : editingId === undefined || connections[0].id === editingId
  const credentialPresent = isPrimaryEditing && !createNew ? status?.credentialPresent : undefined
  const lastResult = status?.lastResult
  const authentication = descriptor?.authModes.find(m => m.id === authMode)
  const effectiveAccount = providerId === 'zentao' && reuseLogin ? (credentials.username ?? '').trim() : account
  const canKeepCredentials = knownConnection?.provider === providerId && knownConnection.authMode === authMode
    && knownConnection.account === effectiveAccount && knownConnection.baseUrl === baseUrl.replace(/\/$/, '')
  const canWrite = canWriteProvider(descriptor)
  const operations = descriptor === undefined ? [] : adapterOperationsOf(descriptor)
  const draft = () => ({ provider: providerId, baseUrl, account: effectiveAccount, authMode, credentials, settings, itemTypes, since,
    intervalMinutes: Number(interval), importStatus, assigneeFilter, matchExisting, direction,
    ...(providerId === 'zentao' ? { mappingMode, includeUnmapped, mappings: mappings.filter(m => includeUnmapped || m.workspaceId) } : { mappings }) })
  const fingerprint = (values = draft()) => JSON.stringify({ ...values,
    itemTypes: [...values.itemTypes].sort(),
    mappings: values.mappings.filter(m => m.projectId && m.workspaceId).slice().sort((a, b) => a.projectId.localeCompare(b.projectId)),
  })
  const currentDraft = fingerprint()
  const dirty = savedDraft !== undefined && currentDraft !== savedDraft
  useEffect(() => {
    if (status && savedDraft === undefined) setSavedDraft(currentDraft)
  }, [status, savedDraft, currentDraft])
  /** Fill the whole form from one stored connection. */
  const loadConnection = (connection: ExternalConnection) => {
    const provider = status?.providers.find(item => item.id === connection.provider)
    const writable = canWriteProvider(provider)
    const primary = connections[0]
    const isPrimary = primary !== undefined && (primary.id !== undefined ? primary.id === connection.id : primary === connection)
    setEditingId(connection.id); setCreateNew(false)
    setProviderId(connection.provider)
    setBaseUrl(connection.baseUrl)
    setAccount(connection.account)
    setAuthMode(connection.authMode)
    // The host never returns secrets: keep them as blanks and let it preserve
    // the stored values when the identity is unchanged.
    setCredentials(isPrimary ? status?.credentialValues ?? {} : {})
    setSettings({ ...Object.fromEntries((provider?.settingsFields ?? []).map(field => [field.key, field.defaultValue])), ...connection.settings })
    setItemTypes(connection.itemTypes)
    setSince(connection.since)
    setIntervalMinutes(String(connection.intervalMinutes))
    setMappingMode(connection.mappingMode ?? 'project')
    setIncludeUnmapped(connection.includeUnmapped ?? false)
    setImportStatus(connection.importStatus ?? 'backlog')
    setAssigneeFilter(connection.assigneeFilter ?? false)
    setMatchExisting(connection.matchExisting ?? provider?.capabilities.dedupe === true)
    setDirection(writable && connection.direction === 'bidirectional' ? 'bidirectional' : 'inbound')
    setReuseLogin(connection.provider !== 'zentao' || (isPrimary && connection.account === (status?.credentialValues?.username ?? '').trim()))
    setMappings(connection.provider === 'zentao' && !connection.mappingMode ? [] : connection.mappings)
    setProjects([]); setProjectsLoaded(false)
    setSavedDraft(undefined)
  }
  const selectProvider = (p: ProviderDescriptor) => {
    setProviderId(p.id); setBaseUrl(p.defaultBaseUrl); setAuthMode(p.authModes[0]!.id)
    setReuseLogin(true); setMappingMode('project'); setIncludeUnmapped(false)
    setAssigneeFilter(false); setMatchExisting(p.capabilities.dedupe === true)
    setCredentials({}); setSettings(Object.fromEntries((p.settingsFields ?? []).map(f => [f.key, f.defaultValue])))
    setItemTypes([p.capabilities.itemTypes[0]!]); setProjects([]); setProjectsLoaded(false); setMappings(p.id === 'zentao' ? [] : [{ projectId: '', workspaceId: '' }])
    // Write-back is the default for providers that declare it; read-only ones stay inbound.
    setDirection(canWriteProvider(p) ? 'bidirectional' : 'inbound')
  }
  /** Empty the form and prepare a brand-new connection (first provider). */
  const startNew = () => {
    setEditingId(undefined); setCreateNew(true)
    setAccount(''); setSince(''); setIntervalMinutes(String(DEFAULT_SYNC_INTERVAL_MINUTES)); setImportStatus('backlog'); setDirection('inbound')
    const first = status?.providers?.[0]
    if (first !== undefined) selectProvider(first)
    setSavedDraft(undefined)
  }
  useEffect(() => {
    let active = true
    void Promise.all([externalRequest<Status>(''), fetch('/dsh-taskboard/workspaces').then(r => r.json())]).then(([s, ws]) => {
      if (!active) return
      setStatus(s); setWorkspaces(ws.value ?? [])
      const c = s.config
      if (c) {
        setEditingId(c.id); setCreateNew(false)
        setProviderId(c.provider); setAuthMode(c.authMode); setItemTypes(c.itemTypes); setSettings(c.settings)
        setCredentials(s.credentialValues ?? {})
        setMappingMode(c.mappingMode ?? 'project')
        setIncludeUnmapped(c.includeUnmapped ?? false)
        setImportStatus(c.importStatus ?? 'backlog')
        setAssigneeFilter(c.assigneeFilter ?? false)
        setMatchExisting(c.matchExisting ?? (s.providers.find(p => p.id === c.provider)?.capabilities.dedupe === true))
        setReuseLogin(c.provider !== 'zentao' || c.account === (s.credentialValues?.username ?? '').trim())
        setDirection(c.direction === 'bidirectional' && canWriteProvider(s.providers.find(p => p.id === c.provider)) ? 'bidirectional' : 'inbound')
        setBaseUrl(c.baseUrl); setAccount(c.account); setSince(c.since); setIntervalMinutes(String(c.intervalMinutes)); setMappings(c.provider === 'zentao' && !c.mappingMode ? [] : c.mappings)
      } else if (s.providers?.[0]) { setCreateNew(true); selectProvider(s.providers[0]) }
    }).catch(e => { if (active) setMessage(String(e.message)) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    const timer = setInterval(() => {
      void externalRequest<Status>('').then(s => { if (active) setStatus(s) }).catch(() => {})
    }, 3000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  const act = async (path: string, body: unknown = {}): Promise<boolean> => {
    setBusy(true); setAction(path); setMessage('')
    try {
      const result = await externalRequest<unknown>(path, body)
      if (path === '/projects') {
        const scopes = result as ExternalProject[]
        setProjects(scopes); setProjectsLoaded(true)
        if (providerId === 'zentao') setMappings(current => [
          ...scopes.map(p => ({ projectId: p.id, workspaceId: current.find(m => m.projectId === p.id)?.workspaceId ?? '' })),
          ...current.filter(m => m.workspaceId && !scopes.some(p => p.id === m.projectId)),
        ])
      }
      if (path === '/account' && result && typeof result === 'object' && 'account' in result) setAccount(String(result.account))
      const next = await externalRequest<Status>('')
      if (path === '/config') {
        // The host answers { id }; a legacy host/mock answers the status itself.
        const savedId = result !== null && typeof result === 'object' && typeof (result as { id?: unknown }).id === 'string'
          ? (result as { id: string }).id : undefined
        const savedPrimary = savedId !== undefined
          ? next.config?.id === savedId
          : editingId === undefined || next.config?.id === editingId
        const savedCredentials = savedPrimary ? next.credentialValues ?? {} : credentials
        setCredentials(savedCredentials)
        setSavedDraft(fingerprint({ ...draft(), credentials: savedCredentials }))
        if (savedId !== undefined) { setEditingId(savedId); setCreateNew(false) }
      }
      setStatus(next); setMessage(path === '/projects' ? t(providerId === 'zentao' ? (includeUnmapped ? 'ext.unmappedMappingsFound' : 'ext.mappingsFound') : 'ext.projectsFound', { count: (result as ExternalProject[]).length }) : t('ext.success'))
      return true
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); return false }
    finally { setBusy(false); setAction('') }
  }
  /** Update one stored connection instead of appending a second one. */
  const configureBody = () => ({ ...draft(), ...(editingId !== undefined ? { connectionId: editingId } : createNew ? { createNew: true } : {}) })
  const syncConnection = async (connection: ExternalConnection) => {
    setActingOn(connection.id)
    try { await act('/sync', connection.id !== undefined ? { connectionId: connection.id } : {}) }
    finally { setActingOn(undefined) }
  }
  const toggleConnection = async (connection: ExternalConnection) => {
    if (connection.id === undefined) return
    setActingOn(connection.id)
    try { await act('/enabled', { connectionId: connection.id, enabled: connection.enabled === false }) }
    finally { setActingOn(undefined) }
  }
  const removeConnection = async (connection: ExternalConnection) => {
    const id = connection.id
    if (id === undefined) return
    if (!window.confirm(t('ext.conn.confirmRemove', { name: connectionName(connection, status?.providers) }))) return
    setActingOn(id)
    const ok = await act('/remove', { connectionId: id })
    setActingOn(undefined)
    if (ok && editingId === id) startNew()
  }
  const enabledConnections = connections.filter(connection => connection.enabled !== false)
  const totalIgnored = connections.reduce((sum, connection) => sum + (stateOf(connection)?.ignoredCount ?? 0), 0)
  return <section className="dsh-atb-diag-sec dsh-atb-external">
    <h4>{t('ext.heading')}</h4><p>{t('ext.hint')}</p>
    <div className="dsh-atb-external-connections">
      <div className="dsh-atb-external-conn-head">
        <b>{t('ext.conn.title')}</b>
        <button type="button" data-action="new" disabled={frozen} onClick={startNew}>{t('ext.conn.new')}</button>
      </div>
      {connections.length === 0
        ? <p className="dsh-atb-external-conn-empty">{t('ext.conn.empty')}</p>
        : <div role="list" aria-label={t('ext.conn.title')}>
          {connections.map((connection, index) => <ConnectionRow
            key={connection.id ?? `connection-${index}`}
            connection={connection}
            provider={status?.providers.find(p => p.id === connection.provider)}
            state={stateOf(connection)}
            disabled={frozen}
            running={stateOf(connection)?.running === true || (busy && actingOn === connection.id)}
            t={t}
            onEdit={() => loadConnection(connection)}
            onToggle={() => void toggleConnection(connection)}
            onSync={() => void syncConnection(connection)}
            onRemove={() => void removeConnection(connection)}
          />)}
        </div>}
      {editing !== undefined && <p className="dsh-atb-external-conn-editing">{t('ext.conn.editing', { name: connectionName(editing, status?.providers) })}</p>}
    </div>
    <fieldset disabled={frozen} style={{ border: 0, padding: 0 }}>
      <label>{t('ext.provider')}<Select
        full
        ariaLabel={t('ext.provider')}
        value={providerId}
        onChange={v => {
          const p = status?.providers.find(item => item.id === v)
          if (p !== undefined) selectProvider(p)
        }}
        options={(status?.providers ?? []).map(p => ({ value: p.id, label: p.name }))}
      /></label>
      {descriptor !== undefined && <div className="dsh-atb-external-capabilities" role="group" aria-label={t('ext.capabilities')}>
        <span>{t('ext.capabilities')}</span>
        <span>{t('ext.contractVersion', { version: descriptor.contractVersion ?? status?.contractVersion ?? 1 })}</span>
        {descriptor.kind !== undefined && <span>{t('ext.kind')}: {capabilityLabel(t, 'ext.kind.', descriptor.kind)}</span>}
        {operations.length > 0 && <span>{t('ext.operations')}: {operations.map(operation => <code key={operation}>{capabilityLabel(t, 'ext.op.', operation)}</code>)}</span>}
        {descriptor.capabilities.events !== undefined && <span>{t('ext.events')}: {capabilityLabel(t, 'ext.events.', descriptor.capabilities.events)}</span>}
        <span className="dsh-atb-external-conn-badge" data-state={canWrite ? 'read-write' : 'read-only'}>{t(canWrite ? 'ext.readWrite' : 'ext.readOnly')}</span>
      </div>}
      <label>{t(providerId === 'zentao' ? 'ext.url' : 'ext.apiUrl')}<input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} /></label>
      {providerId !== 'zentao' && <>
        <label>{t('ext.account')}<input value={account} onChange={e => setAccount(e.target.value)} /></label>
        {!descriptor?.capabilities.accountDiscovery && <p>{t('ext.manualAccount')}</p>}
      </>}
      <label>{t('ext.authMode')}<Select
        full
        ariaLabel={t('ext.authMode')}
        value={authMode}
        onChange={v => { setAuthMode(v); setCredentials({}) }}
        options={(descriptor?.authModes ?? []).map(m => ({ value: m.id, label: t(m.label) }))}
      /></label>
      {authentication?.fields.map(field => <label key={field.key}>{t(field.label)}<input type={field.secret === false ? 'text' : 'password'} autoComplete={field.secret === false ? 'username' : 'new-password'} value={credentials[field.key] ?? ''}
        placeholder={canKeepCredentials && credentialPresent?.[field.key] ? t('ext.tokenSaved') : ''}
        onChange={e => setCredentials({ ...credentials, [field.key]: e.target.value })} /></label>)}
      {providerId === 'zentao' && <>
        <label style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={reuseLogin}
          onChange={e => { setReuseLogin(e.target.checked); if (!e.target.checked && !account) setAccount(credentials.username ?? '') }} />{t('ext.reuseLogin')}</label>
        {!reuseLogin && <label>{t('ext.assigneeAccount')}<input value={account} onChange={e => setAccount(e.target.value)} /></label>}
      </>}
      <div className="dsh-atb-external-options" role="group" aria-label={t(providerId === 'zentao' ? 'ext.syncScope' : 'ext.itemTypes')}>
        {providerId === 'zentao' && <span>{t('ext.syncScope')}</span>}
        {descriptor?.capabilities.itemTypes.map(type => <label key={type} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={itemTypes.includes(type)} disabled={providerId === 'zentao' && itemTypes.length === 1 && itemTypes.includes(type)} onChange={e => setItemTypes(e.target.checked ? [...itemTypes, type] : itemTypes.filter(v => v !== type))} />{externalTypeLabel(type, t)}
        </label>)}
      </div>
      {canWrite && <>
        <div className="dsh-atb-external-options" role="group" aria-label={t('ext.direction')}>
          <span>{t('ext.direction')}</span>
          <label style={{ flexDirection: 'row', alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={direction === 'bidirectional'}
              onChange={e => setDirection(e.target.checked ? 'bidirectional' : 'inbound')} />{t('ext.bidirectional')}
          </label>
        </div>
        {direction === 'bidirectional'
          ? <p role="alert">{t('ext.bidirectionalWarning')}</p>
          : <p>{t('ext.inboundOnly')}</p>}
      </>}
      {descriptor?.settingsFields?.map(field => <label key={field.key}>{t(field.label)}<input value={settings[field.key] ?? field.defaultValue} onChange={e => setSettings({ ...settings, [field.key]: e.target.value })} /></label>)}
      <label>{t('ext.since')}<input type="date" value={since} onChange={e => setSince(e.target.value)} /></label>
      <label>{t('ext.interval')}<input type="number" min="0" max="1440" value={interval} onChange={e => setIntervalMinutes(e.target.value)} /></label>
      <label>{t('ext.importStatus')}<Select
        full
        ariaLabel={t('ext.importStatus')}
        value={importStatus}
        onChange={v => setImportStatus(v as 'backlog' | 'todo')}
        options={[
          { value: 'backlog', label: t('ext.importBacklog') },
          { value: 'todo', label: t('ext.importTodo') },
        ]}
      /></label>
      <label style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={assigneeFilter}
        onChange={e => setAssigneeFilter(e.target.checked)} />{t('ext.assigneeFilter')}</label>
      {descriptor?.capabilities.dedupe === true && <>
        <label style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={matchExisting}
          onChange={e => setMatchExisting(e.target.checked)} />{t('ext.matchExisting')}</label>
        {matchExisting && <p>{t('ext.matchExistingHint')}</p>}
      </>}
      {providerId === 'zentao' && <div className="dsh-atb-external-options" role="radiogroup" aria-label={t('ext.mappingMode')}>
        <span>{t('ext.mappingMode')}</span>
          {(['project', 'execution'] as const).map(mode => <label key={mode} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <input type="radio" name="dsh-atb-mapping-mode" value={mode} checked={mappingMode === mode} style={{ width: 'auto' }}
              onChange={() => { setMappingMode(mode); setProjects([]); setProjectsLoaded(false); setMappings([]) }} />{t(mode === 'project' ? 'ext.linkProject' : 'ext.linkExecution')}
          </label>)}
      </div>}
      {providerId === 'zentao' && <>
        <label style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={includeUnmapped}
          onChange={e => setIncludeUnmapped(e.target.checked)} />{t(mappingMode === 'project' ? 'ext.syncUnmappedProjects' : 'ext.syncUnmappedExecutions')}</label>
      </>}
      {providerId === 'zentao' && (editing === undefined ? status?.requiresMappingReview : stateOf(editing)?.requiresMappingReview) === true
        && <p role="alert">{t('ext.remapRequired')}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '9px 0' }}>
        <button type="button" onClick={() => void act('/test', { ...draft(), mappings: providerId === 'zentao' ? mappings.filter(m => m.workspaceId) : mappings.filter(m => m.projectId || m.workspaceId) })}>{t('ext.test')}</button>
        {descriptor?.capabilities.projectDiscovery && <button type="button" onClick={() => void act('/projects', { ...draft(), mappings: [] })}>{t(providerId === 'zentao' ? 'ext.discoverMappings' : 'ext.discoverProjects')}</button>}
      </div>
      {providerId === 'zentao' && !mappings.length && <p>{t(projectsLoaded ? 'ext.noScopes' : 'ext.loadMappings')}</p>}
      {mappings.map((m, index) => <div key={providerId === 'zentao' ? m.projectId : index} className="dsh-atb-external-mapping">
        {providerId === 'zentao' ? <div className="dsh-atb-external-scope-info">
          <b>{projects.find(p => p.id === m.projectId)?.name ?? `ID: ${m.projectId.split(':')[1]}`}</b>
          <span>{t(mappingMode === 'project' ? 'ext.projectId' : 'ext.executionId')}: {m.projectId.split(':')[1]}</span>
          {projectsLoaded && !projects.some(p => p.id === m.projectId) && <span role="alert">{t('ext.scopeUnavailable')}</span>}
        </div> : <>
        <label>{t(descriptor?.scopeLabel ?? 'ext.projectId')}
          <ScopePicker t={t} ariaLabel={t(descriptor?.scopeLabel ?? 'ext.projectId')} loaded={projectsLoaded} value={m.projectId} projects={projects}
            onChange={value => setMappings(mappings.map((v, i) => i === index ? { ...v, projectId: value } : v))} />
        </label></>}
        <label>{t('ext.workspace')}<Select
          full
          ariaLabel={t('ext.workspace')}
          value={m.workspaceId}
          onChange={v => setMappings(mappings.map((item, i) => i === index ? { ...item, workspaceId: v } : item))}
          options={[
            { value: '', label: providerId === 'zentao' ? t('ext.unlinked') : '—' },
            ...workspaces.map(ws => ({ value: ws.id, label: ws.title })),
          ]}
        /></label>
        {providerId !== 'zentao' && <button type="button" className="dsh-atb-external-remove" aria-label={t('ext.removeMapping', { n: index + 1 })} title={t('ext.removeMapping', { n: index + 1 })}
          disabled={mappings.length === 1} onClick={() => setMappings(mappings.filter((_, i) => i !== index))}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg>
        </button>}
      </div>)}
      {dirty && <p role="status">{t('ext.unsavedChanges')}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {providerId !== 'zentao' && <button type="button" onClick={() => setMappings([...mappings, { projectId: '', workspaceId: '' }])}>{t('ext.addMapping')}</button>}
        {descriptor?.capabilities.accountDiscovery && <button type="button" disabled={connections.length === 0} onClick={() => void act('/account')}>{t('ext.discoverAccount')}</button>}
        <button type="button" disabled={providerId === 'zentao' && projectsLoaded && mappings.some(m => m.workspaceId && !projects.some(p => p.id === m.projectId))} onClick={() => void act('/config', configureBody())}>{t('ext.save')}</button>
        <button type="button" disabled={enabledConnections.length === 0 || dirty
          || enabledConnections.every(connection => stateOf(connection)?.requiresMappingReview === true)} title={dirty ? t('ext.unsavedChanges') : undefined} onClick={() => void act('/sync')}>{t('ext.sync')}</button>
        <button type="button" disabled={totalIgnored === 0} onClick={() => void act('/ignored/clear')}>{t('ext.clearIgnored')}</button>
      </div>
    </fieldset>
    {(action === '/sync' || status?.running) && <button type="button" onClick={() => { void externalRequest('/cancel', {}).catch(() => {}) }}>{t('ext.cancel')}</button>}
    {busy && <p role="status">{t('ext.busy')}</p>}
    {message && <p role="status">{message}</p>}
    {status?.lastError && <p role="alert">{status.lastError}</p>}
    {status?.lastAttemptAt !== undefined && <p>{t('ext.lastAttempt')}: {new Date(status.lastAttemptAt).toLocaleString()}</p>}
    {status?.lastResult && <p>{t('ext.result', status.lastResult)} · {new Date(status.lastResult.at).toLocaleString()}</p>}
    {lastResult !== undefined && (lastResult.linked ?? 0) > 0 && <p>{t('ext.resultLinked', { count: lastResult.linked ?? 0 })}</p>}
    {lastResult !== undefined && (lastResult.ambiguous ?? 0) > 0 && <p>{t('ext.resultAmbiguous', { count: lastResult.ambiguous ?? 0 })}</p>}
    {lastResult !== undefined && (lastResult.pushed ?? 0) > 0 && <p>{t('ext.resultPushed', { count: lastResult.pushed ?? 0 })}</p>}
    {lastResult !== undefined && (lastResult.pushFailed ?? 0) > 0 && <p>{t('ext.resultPushFailed', { count: lastResult.pushFailed ?? 0 })}</p>}
  </section>
}
