import type { ExternalConfig } from '../shared/external.ts'
import { ExternalProviderRegistry } from './external-provider.ts'
import { ZentaoProvider } from './zentao.ts'
import { TapdProvider } from './tapd.ts'
import { GithubProvider } from './github.ts'

const validateNumericProjects = (config: ExternalConfig) => {
  if (config.mappings.some(m => !/^\d+$/.test(m.projectId))) throw new Error('provider requires numeric project IDs')
}

/** Add new providers here; synchronization and UI consume descriptors without platform branches. */
export function createBuiltinProviders(): ExternalProviderRegistry {
  return new ExternalProviderRegistry().register({
    descriptor: { id: 'zentao', name: 'ZenTao', scopeLabel: 'ext.projectId', defaultBaseUrl: '',
      contractVersion: 1, kind: 'planning',
      settingsFields: [{ key: 'requestIntervalMs', label: 'ext.requestInterval', defaultValue: '200' }],
      authModes: [
        { id: 'password', label: 'ext.usernamePassword', fields: [{ key: 'username', label: 'ext.username', secret: false }, { key: 'password', label: 'ext.password' }] },
      ],
      capabilities: { itemTypes: ['bug', 'story', 'task'], projectDiscovery: true, accountDiscovery: false, pagination: 'page', incremental: false,
        operations: ['validateConnection', 'getCapabilities', 'discoverProjects', 'listWorkItems', 'getWorkItem'],
        directions: ['inbound'], events: 'poll' } },
    validate: config => {
      const pattern = config.mappingMode ? new RegExp(`^${config.mappingMode}:\\d+$`) : /^(execution:)?\d+$/
      if (config.mappings.some(m => !pattern.test(m.projectId))) throw new Error('ZenTao mapping IDs must match the selected mapping mode')
      const interval = Number(config.settings.requestIntervalMs ?? 200)
      if (!Number.isInteger(interval) || interval < 0 || interval > 10_000) throw new Error('request interval must be 0–10000 milliseconds')
    },
    create: config => new ZentaoProvider(config),
  }).register({
    descriptor: { id: 'tapd', name: 'TAPD', scopeLabel: 'ext.projectId', defaultBaseUrl: 'https://api.tapd.cn',
      contractVersion: 1, kind: 'planning',
      authModes: [
        { id: 'basic', label: 'Basic Auth', fields: [{ key: 'apiUser', label: 'ext.apiUser' }, { key: 'apiPassword', label: 'ext.apiPassword' }] },
        { id: 'bearer', label: 'Bearer Token', fields: [{ key: 'accessToken', label: 'Access Token' }] },
      ],
      settingsFields: [
        { key: 'companyId', label: 'ext.companyId', defaultValue: '' },
        { key: 'terminalStatuses', label: 'ext.terminalStatuses', defaultValue: 'closed,resolved,done,rejected' },
        { key: 'urgentPriorities', label: 'ext.urgentPriorities', defaultValue: 'urgent,high,紧急,高' },
        { key: 'relaxedPriorities', label: 'ext.relaxedPriorities', defaultValue: 'low,nice to have,低' },
      ],
      capabilities: { itemTypes: ['bug', 'story', 'task'], projectDiscovery: true, accountDiscovery: false, pagination: 'cursor', incremental: false,
        operations: ['validateConnection', 'getCapabilities', 'discoverProjects', 'listWorkItems', 'getWorkItem'],
        directions: ['inbound'], events: 'poll' } },
    validate: config => {
      validateNumericProjects(config)
      if (config.settings.companyId && !/^\d+$/.test(config.settings.companyId)) throw new Error('invalid company ID')
      if (config.authMode === 'basic' && config.credentials.apiUser?.includes(':')) throw new Error('API username cannot contain a colon')
    },
    create: config => new TapdProvider(config),
  }).register({
    descriptor: { id: 'github', name: 'GitHub', scopeLabel: 'ext.repoScope', defaultBaseUrl: 'https://api.github.com',
      contractVersion: 1, kind: 'forge',
      settingsFields: [
        { key: 'urgentLabels', label: 'ext.urgentLabels', defaultValue: 'urgent,priority: urgent,priority/urgent,p0,p1,紧急' },
        { key: 'relaxedLabels', label: 'ext.relaxedLabels', defaultValue: 'low,minor,priority: low,低' },
      ],
      authModes: [
        { id: 'token', label: 'ext.githubToken', fields: [{ key: 'token', label: 'ext.githubToken' }] },
      ],
      capabilities: { itemTypes: ['issue'], projectDiscovery: true, accountDiscovery: true, pagination: 'page', incremental: true, write: true, dedupe: true,
        operations: ['validateConnection', 'getCapabilities', 'discoverProjects', 'listWorkItems', 'getWorkItem', 'createWorkItem', 'updateWorkItem'],
        directions: ['inbound', 'outbound'], events: 'poll',
        limits: { pageSize: 100, maxPages: 1000, requestTimeoutMs: 30_000 } } },
    validate: config => {
      if (config.authMode !== 'token') throw new Error('unsupported GitHub authentication mode')
      if (config.mappings.some(m => !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(m.projectId))) throw new Error('GitHub scopes must be owner/repo')
    },
    create: config => new GithubProvider(config),
  })
}
