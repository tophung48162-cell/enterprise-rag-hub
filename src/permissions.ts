import type { Role } from './types'

export const ROLE_STORAGE_KEY = 'enterprise-rag-role'

export const ROLE_LABELS: Record<Role, string> = {
  admin: '管理员',
  manager: '知识库管理人员',
  user: '使用者',
}

export const ROLE_OPTIONS = (
  Object.entries(ROLE_LABELS) as Array<[Role, string]>
).map(([value, label]) => ({ value, label }))

export type AppMenuPath = '/workbench' | '/chat' | '/knowledge' | '/applications' | '/models' | '/logs' | '/observability'

export interface PermissionedMenuItem {
  key: 'workbench' | 'chat' | 'knowledge' | 'applications' | 'models' | 'logs' | 'observability'
  label: string
  path: AppMenuPath
  roles: readonly Role[]
}

export const APP_MENU_ITEMS: readonly PermissionedMenuItem[] = [
  { key: 'workbench', label: '工作台', path: '/workbench', roles: ['admin', 'manager', 'user'] },
  { key: 'models', label: '模型服务', path: '/models', roles: ['admin'] },
  {
    key: 'knowledge',
    label: '知识库',
    path: '/knowledge',
    roles: ['admin', 'manager'],
  },
  { key: 'applications', label: '问答应用', path: '/applications', roles: ['admin', 'manager', 'user'] },
  { key: 'chat', label: '在线对话', path: '/chat', roles: ['admin', 'manager', 'user'] },
  {
    key: 'logs',
    label: '运行日志',
    path: '/logs',
    roles: ['admin', 'manager'],
  },
  {
    key: 'observability',
    label: '可观测',
    path: '/observability',
    roles: ['admin', 'manager'],
  },
]

const DEFAULT_ROLE: Role = 'user'

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

export function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'manager' || value === 'user'
}

/**
 * Converts data from untrusted sources (URL, storage, API) to a valid role.
 * Unknown or missing values deliberately receive the least privileged role.
 */
export function normalizeRole(value: unknown): Role {
  return isRole(value) ? value : DEFAULT_ROLE
}

function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined

  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function readStoredRole(
  storage: ReadableStorage | null | undefined = browserStorage(),
): Role {
  if (!storage) return DEFAULT_ROLE

  try {
    return normalizeRole(storage.getItem(ROLE_STORAGE_KEY))
  } catch {
    return DEFAULT_ROLE
  }
}

/** Returns false when storage is unavailable, while keeping role switching usable. */
export function persistRole(
  role: Role,
  storage: WritableStorage | null | undefined = browserStorage(),
): boolean {
  if (!storage) return false

  try {
    storage.setItem(ROLE_STORAGE_KEY, role)
    return true
  } catch {
    return false
  }
}

export function getAccessibleMenuItems(role: Role): readonly PermissionedMenuItem[] {
  const safeRole = normalizeRole(role)
  return APP_MENU_ITEMS.filter((item) => item.roles.includes(safeRole))
}

function pathMatchesBase(pathname: string, base: AppMenuPath): boolean {
  return pathname === base || pathname.startsWith(`${base}/`)
}

function cleanPath(pathname: string): string {
  const [withoutHash] = pathname.split('#', 1)
  const [withoutQuery] = withoutHash.split('?', 1)
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.replace(/\/+$/, '')
  }
  return withoutQuery || '/'
}

/**
 * Checks both menu routes and nested routes such as /knowledge/:id.
 * Root is always allowed so the router can resolve it to the role's default route.
 */
export function canAccessPath(role: Role, pathname: string): boolean {
  const safePath = cleanPath(pathname)
  if (safePath === '/') return true

  return getAccessibleMenuItems(role).some((item) =>
    pathMatchesBase(safePath, item.path),
  )
}

export function getDefaultRoute(role: Role = 'user'): AppMenuPath {
  return '/workbench'
}
