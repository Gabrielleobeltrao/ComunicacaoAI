// A porta pública da camada de recursos.
export * from './types.js'
export { listResources } from './catalog.js'
export { resolveResourceAccess, resolveAgentResourceAccess } from './access.js'
export { adapterFor, availableKinds } from './registry.js'
export { parseSubject, resolveSubject, resolveAgentSubject } from './scope.js'
export { ensureResourceAuditIndexes, recordAccessEvent, listAccessEvents } from './audit.js'
