import type { UserRole } from '../types';
import { ROLE_POLICY } from './rolePolicy';

export const USER_LIST_DEFAULT_PAGE_SIZE = 20;
export const USER_LIST_MAX_PAGE_SIZE = 100;
export const USER_LIST_SEARCH_MAX_LEN = 64;

export type UserListQuery = {
  page: number;
  pageSize: number;
  q: string;
  role: UserRole | '';
};

export type UserListQueryInput = {
  page?: string | number | null;
  pageSize?: string | number | null;
  q?: string | null;
  role?: string | null;
};

export const USER_LIST_ROLE_FILTERS: Array<{ value: UserRole | ''; label: string }> = [
  { value: '', label: '全部权限组' },
  { value: 'guest', label: ROLE_POLICY.getRoleDisplayName('guest') },
  { value: 'user', label: ROLE_POLICY.getRoleDisplayName('user') },
  { value: 'vip', label: ROLE_POLICY.getRoleDisplayName('vip') },
  { value: 'admin', label: ROLE_POLICY.getRoleDisplayName('admin') },
];

function toInt(raw: string | number | null | undefined, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function parseUserListQuery(input: UserListQueryInput = {}): UserListQuery {
  let page = toInt(input.page, 1);
  if (page < 1) page = 1;

  let pageSize = toInt(input.pageSize, USER_LIST_DEFAULT_PAGE_SIZE);
  if (pageSize < 1) pageSize = USER_LIST_DEFAULT_PAGE_SIZE;
  if (pageSize > USER_LIST_MAX_PAGE_SIZE) pageSize = USER_LIST_MAX_PAGE_SIZE;

  const q = (input.q ?? '').trim().slice(0, USER_LIST_SEARCH_MAX_LEN);
  const roleRaw = (input.role ?? '').trim();
  const role = (ROLE_POLICY.VALID_ROLES as readonly string[]).includes(roleRaw)
    ? (roleRaw as UserRole)
    : '';

  return { page, pageSize, q, role };
}

/** SQLite LIKE 通配符转义，配合 ESCAPE '!' 使用。 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[!%_]/g, '!$&');
}

export function buildUserListWhere(query: Pick<UserListQuery, 'q' | 'role'>): {
  sql: string;
  binds: string[];
} {
  const conditions: string[] = [];
  const binds: string[] = [];

  if (query.q) {
    conditions.push("(username LIKE ? ESCAPE '!' OR IFNULL(discord_username, '') LIKE ? ESCAPE '!')");
    const pattern = `%${escapeLikePattern(query.q)}%`;
    binds.push(pattern, pattern);
  }
  if (query.role) {
    conditions.push('role = ?');
    binds.push(query.role);
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    binds,
  };
}

export function userListOffset(query: UserListQuery): number {
  return (query.page - 1) * query.pageSize;
}

export function userListTotalPages(total: number, pageSize: number): number {
  if (pageSize <= 0 || total <= 0) return 0;
  return Math.ceil(total / pageSize);
}

export function userListQueryString(input: UserListQueryInput = {}): string {
  const parsed = parseUserListQuery(input);
  const params = new URLSearchParams();
  params.set('page', String(parsed.page));
  params.set('pageSize', String(parsed.pageSize));
  if (parsed.q) params.set('q', parsed.q);
  if (parsed.role) params.set('role', parsed.role);
  return params.toString();
}

export function userListPageButtons(current: number, total: number, max = 5): number[] {
  if (total <= 0) return [];
  if (total <= max) return Array.from({ length: total }, (_, i) => i + 1);
  const start = Math.max(1, Math.min(current - Math.floor(max / 2), total - max + 1));
  return Array.from({ length: max }, (_, i) => start + i);
}
