// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '../app/version';
import { STALE_GUEST_IDLE_MS } from '../config/staleUsers';
import { USER_LIST_DEFAULT_PAGE_SIZE } from '../config/userListQuery';
import { ThemeProvider } from '../theme';
import type { Artist, User } from '../types';
import { FeedbackProvider } from './ui/Feedback';
import { ArtistAdmin } from './ArtistAdmin';

const dbMocks = vi.hoisted(() => ({
  getUsers: vi.fn(),
  updateUserRole: vi.fn(async () => ({ success: true, role: 'user', maxStorage: 0 })),
  createUser: vi.fn(async () => {}),
  deleteUser: vi.fn(async () => {}),
  updateUserQuota: vi.fn(async () => {}),
  demoteStaleUsers: vi.fn(async () => ({ success: true, count: 0 })),
  getUsageStats: vi.fn(async () => null),
  clearOldLogs: vi.fn(async () => {}),
  updatePassword: vi.fn(async () => {}),
  importArtistFromGithub: vi.fn(async () => {}),
  saveArtist: vi.fn(async () => {}),
  deleteArtist: vi.fn(async () => {}),
}));

vi.mock('../services/dbService', () => ({
  db: dbMocks,
}));

afterEach(cleanup);

const guest: User = { id: 'g', username: 'visitor', role: 'guest', createdAt: 0 };
const admin: User = { id: 'a', username: 'admin', role: 'admin', createdAt: 0 };

function makeUser(partial: Partial<User> & Pick<User, 'id' | 'username'>): User {
  return {
    role: 'user',
    createdAt: 1,
    storageUsage: 0,
    maxStorage: 300 * 1024 * 1024,
    ...partial,
  };
}

function paginateUsers(all: User[], opts: { page?: number; pageSize?: number; q?: string; role?: string } = {}) {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? USER_LIST_DEFAULT_PAGE_SIZE;
  const q = (opts.q ?? '').toLowerCase();
  const role = opts.role ?? '';
  let rows = all;
  if (q) {
    rows = rows.filter((u) =>
      u.username.toLowerCase().includes(q) || (u.discordUsername || '').toLowerCase().includes(q),
    );
  }
  if (role) rows = rows.filter((u) => u.role === role);
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return {
    data: rows.slice(start, start + pageSize),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 0,
    },
  };
}

function seedUsers(all: User[]) {
  dbMocks.getUsers.mockImplementation(async (opts) => paginateUsers(all, opts));
}

function renderAdmin(user: User, usersData: User[] = [], artistsData: Artist[] = []) {
  seedUsers(usersData);
  return render(
    <ThemeProvider>
      <FeedbackProvider>
        <ArtistAdmin
          currentUser={user}
          artistsData={artistsData}
          onRefreshArtists={vi.fn(async () => {})}
        />
      </FeedbackProvider>
    </ThemeProvider>,
  );
}

async function openUsersTab() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: '用户管理' }));
  await waitFor(() => expect(dbMocks.getUsers).toHaveBeenCalled());
  return user;
}

function settingsTabs() {
  return within(screen.getByRole('tablist', { name: '设置分区' })).getAllByRole('tab');
}

describe('ArtistAdmin tabs', () => {
  beforeEach(() => {
    dbMocks.getUsers.mockReset();
    seedUsers([]);
  });

  it('关于在标签最后，偏好设置顺序是账号、偏好、外观', () => {
    renderAdmin(guest);
    expect(settingsTabs().map((tab) => tab.textContent)).toEqual(['偏好设置', '关于']);
    const account = screen.getByRole('heading', { name: '账号' });
    const prefs = screen.getByRole('heading', { name: '偏好' });
    const appearance = screen.getByRole('heading', { name: '外观' });
    expect(account.compareDocumentPosition(prefs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(prefs.compareDocumentPosition(appearance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '产品信息' })).toBeNull();
  });

  it('管理员标签顺序是偏好 / 画师 / 用户 / 统计 / 关于', async () => {
    const user = userEvent.setup();
    renderAdmin(admin);
    expect(settingsTabs().map((tab) => tab.textContent)).toEqual([
      '偏好设置',
      '画师管理',
      '用户管理',
      '使用统计',
      '关于',
    ]);

    await user.click(screen.getByRole('tab', { name: '关于' }));
    expect(screen.getByRole('heading', { name: '产品信息' })).toBeInTheDocument();
    expect(screen.getByText(`v${APP_VERSION}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /仓库/ })).toBeInTheDocument();
  });

  it('用户管理可选游客，并提供批量改回游客', async () => {
    const alice = makeUser({
      id: 'u1',
      username: 'alice',
      lastLogin: Date.now() - STALE_GUEST_IDLE_MS - 1000,
    });
    renderAdmin(admin, [alice]);
    await openUsersTab();
    const role = await screen.findByRole('combobox', { name: 'alice 的角色' });
    expect(role).toHaveClass('role-select');
    expect(role).not.toHaveClass('role-pill');
    expect(within(role).getByRole('option', { name: '游客' })).toBeInTheDocument();
    expect(within(role).getByRole('option', { name: '普通用户' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批量改回游客' })).toBeInTheDocument();
    expect(screen.getByText(/作用于全库/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Discord 游客' })).toBeNull();
  });

  it('修改密码没有新密码标签，按钮和输入框并排', () => {
    renderAdmin({ id: 'm', username: 'mira', role: 'user', createdAt: 0 });
    expect(screen.queryByText('新密码', { selector: 'label' })).toBeNull();
    const input = screen.getByPlaceholderText('新密码');
    const submit = screen.getByRole('button', { name: '更新密码' });
    expect(input).toHaveAttribute('aria-label', '新密码');
    expect(input.closest('.pref-row')).toContainElement(submit);
  });

  it('关联 Discord 按钮左侧带图标，压缩标题为本地图片压缩', () => {
    renderAdmin({ id: 'm', username: 'mira', role: 'user', createdAt: 0 });
    const discord = screen.getByRole('button', { name: '关联 Discord' });
    expect(discord.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('heading', { name: '本地图片压缩' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^图片压缩$/ })).toBeNull();
  });

  it('游客不显示存储配额和修改配额', async () => {
    const visitor = makeUser({
      id: 'g1',
      username: '暮春',
      role: 'guest',
      maxStorage: 100 * 1024 * 1024,
    });
    const alice = makeUser({ id: 'u1', username: 'alice' });
    renderAdmin(admin, [visitor, alice]);
    await openUsersTab();
    const guestRow = (await screen.findByText('暮春')).closest('tr');
    const userRow = screen.getByText('alice').closest('tr');
    expect(guestRow).toBeTruthy();
    expect(userRow).toBeTruthy();
    expect(within(guestRow as HTMLElement).getByText('无配额')).toBeInTheDocument();
    expect(within(guestRow as HTMLElement).queryByRole('button', { name: '修改配额' })).toBeNull();
    expect(within(guestRow as HTMLElement).queryByText(/MB/)).toBeNull();
    expect(within(userRow as HTMLElement).getByRole('button', { name: '修改配额' })).toBeInTheDocument();
  });

  it('画师管理用图标编辑删除，长名字截断', async () => {
    const user = userEvent.setup();
    const longName = 'very_long_artist_name_(spice!!)_that_should_ellipsis';
    renderAdmin(admin, [], [{ id: 'art1', name: longName, imageUrl: 'https://example.com/a.png' }]);
    await user.click(screen.getByRole('tab', { name: '画师管理' }));
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '编辑' })).toHaveClass('icon-btn');
    expect(screen.getByRole('button', { name: '删除' })).toHaveClass('icon-btn');
    expect(screen.queryByRole('button', { name: '编辑' })?.textContent).toBe('');
    const name = screen.getByText(longName);
    expect(name).toHaveAttribute('title', longName);
    expect(name.closest('.artist-admin-name')).toBeTruthy();
  });

  it('用户管理可按用户名或 Discord 名搜索', async () => {
    const alice = makeUser({ id: 'u1', username: 'alice' });
    const bob = makeUser({ id: 'u2', username: 'bob', role: 'vip' });
    const dusk = makeUser({ id: 'g1', username: '暮春', role: 'guest', discordUsername: 'kira_fish' });
    renderAdmin(admin, [alice, bob, dusk]);
    const user = await openUsersTab();
    await screen.findByText('alice');
    await user.type(screen.getByRole('searchbox', { name: '搜索用户' }), 'kira');
    await waitFor(() => {
      expect(screen.getByText('暮春')).toBeInTheDocument();
      expect(screen.queryByText('alice')).toBeNull();
      expect(screen.queryByText('bob')).toBeNull();
    });
    expect(dbMocks.getUsers).toHaveBeenCalledWith(expect.objectContaining({ q: 'kira', page: 1 }));
  });

  it('用户管理可按权限组筛选', async () => {
    const alice = makeUser({ id: 'u1', username: 'alice' });
    const bob = makeUser({ id: 'u2', username: 'bob', role: 'vip' });
    const dusk = makeUser({ id: 'g1', username: '暮春', role: 'guest' });
    renderAdmin(admin, [alice, bob, dusk]);
    const user = await openUsersTab();
    await screen.findByText('alice');
    await user.selectOptions(screen.getByRole('combobox', { name: '按权限组筛选' }), 'vip');
    await waitFor(() => {
      expect(screen.getByText('bob')).toBeInTheDocument();
      expect(screen.queryByText('alice')).toBeNull();
      expect(screen.queryByText('暮春')).toBeNull();
    });
    expect(dbMocks.getUsers).toHaveBeenCalledWith(expect.objectContaining({ role: 'vip', page: 1 }));
  });

  it('用户管理超过一页时可以翻页', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeUser({ id: `u${i + 1}`, username: `user${String(i + 1).padStart(2, '0')}`, createdAt: 25 - i }),
    );
    renderAdmin(admin, many);
    const user = await openUsersTab();
    await screen.findByText('user01');
    expect(screen.getByText('user20')).toBeInTheDocument();
    expect(screen.queryByText('user21')).toBeNull();
    expect(screen.getByText(/共 25 人/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => {
      expect(screen.getByText('user21')).toBeInTheDocument();
      expect(screen.queryByText('user01')).toBeNull();
    });
    expect(dbMocks.getUsers).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
  });
});
