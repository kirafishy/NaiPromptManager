import { describe, expect, it } from 'vitest';
import {
  USER_LIST_DEFAULT_PAGE_SIZE,
  USER_LIST_MAX_PAGE_SIZE,
  USER_LIST_SEARCH_MAX_LEN,
  buildUserListWhere,
  escapeLikePattern,
  parseUserListQuery,
  userListOffset,
  userListPageButtons,
  userListQueryString,
  userListTotalPages,
} from './userListQuery';

describe('parseUserListQuery', () => {
  it('缺省为第 1 页、默认页大小、无搜索无角色', () => {
    expect(parseUserListQuery()).toEqual({
      page: 1,
      pageSize: USER_LIST_DEFAULT_PAGE_SIZE,
      q: '',
      role: '',
    });
  });

  it('page=0 或负数回落到第 1 页', () => {
    expect(parseUserListQuery({ page: 0 }).page).toBe(1);
    expect(parseUserListQuery({ page: -3 }).page).toBe(1);
  });

  it('非法数字回落默认值，页大小有上限', () => {
    expect(parseUserListQuery({ page: 'x', pageSize: 'nope' })).toMatchObject({
      page: 1,
      pageSize: USER_LIST_DEFAULT_PAGE_SIZE,
    });
    expect(parseUserListQuery({ pageSize: 9999 }).pageSize).toBe(USER_LIST_MAX_PAGE_SIZE);
    expect(parseUserListQuery({ pageSize: 0 }).pageSize).toBe(USER_LIST_DEFAULT_PAGE_SIZE);
  });

  it('只接受有效角色，其它值视为全部', () => {
    expect(parseUserListQuery({ role: 'vip' }).role).toBe('vip');
    expect(parseUserListQuery({ role: 'guest' }).role).toBe('guest');
    expect(parseUserListQuery({ role: 'super' }).role).toBe('');
    expect(parseUserListQuery({ role: ' ' }).role).toBe('');
  });

  it('搜索词去空白并截断', () => {
    expect(parseUserListQuery({ q: '  alice  ' }).q).toBe('alice');
    expect(parseUserListQuery({ q: 'a'.repeat(USER_LIST_SEARCH_MAX_LEN + 8) }).q).toHaveLength(USER_LIST_SEARCH_MAX_LEN);
  });
});

describe('buildUserListWhere', () => {
  it('无条件时 WHERE 为空', () => {
    expect(buildUserListWhere({ q: '', role: '' })).toEqual({ sql: '', binds: [] });
  });

  it('按用户名和 Discord 名模糊搜索，并转义通配符', () => {
    const { sql, binds } = buildUserListWhere({ q: 'a%b_c!', role: '' });
    expect(sql).toContain('username LIKE ? ESCAPE \'!\'');
    expect(sql).toContain("IFNULL(discord_username, '') LIKE ? ESCAPE '!'");
    expect(binds).toEqual(['%a!%b!_c!!%', '%a!%b!_c!!%']);
  });

  it('角色筛选与搜索可叠加', () => {
    const { sql, binds } = buildUserListWhere({ q: 'mira', role: 'guest' });
    expect(sql).toMatch(/^WHERE .+ AND .+$/);
    expect(binds).toEqual(['%mira%', '%mira%', 'guest']);
  });
});

describe('userList helpers', () => {
  it('offset 按 1 基页码计算', () => {
    expect(userListOffset({ page: 1, pageSize: 20, q: '', role: '' })).toBe(0);
    expect(userListOffset({ page: 3, pageSize: 20, q: '', role: '' })).toBe(40);
  });

  it('总页数在空列表时为 0', () => {
    expect(userListTotalPages(0, 20)).toBe(0);
    expect(userListTotalPages(21, 20)).toBe(2);
  });

  it('query string 省略空搜索和角色', () => {
    expect(userListQueryString({ page: 2, pageSize: 20, q: '  bob ', role: 'user' })).toBe(
      'page=2&pageSize=20&q=bob&role=user',
    );
    expect(userListQueryString()).toBe(`page=1&pageSize=${USER_LIST_DEFAULT_PAGE_SIZE}`);
  });

  it('页码按钮窗口夹在两端', () => {
    expect(userListPageButtons(1, 3)).toEqual([1, 2, 3]);
    expect(userListPageButtons(1, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(userListPageButtons(10, 10)).toEqual([6, 7, 8, 9, 10]);
    expect(userListPageButtons(5, 10)).toEqual([3, 4, 5, 6, 7]);
  });

  it('LIKE 转义覆盖 % _ !', () => {
    expect(escapeLikePattern('100%_off!')).toBe('100!%!_off!!');
  });
});
