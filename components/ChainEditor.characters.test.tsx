// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptChain, User } from '../types';
import { DEFAULT_NAI_PARAMS } from '../services/naiModels';
import { ChainEditor } from './ChainEditor';
import { FeedbackProvider } from './ui/Feedback';

afterEach(cleanup);

const chain: PromptChain = {
  id: 'c1',
  userId: 'u1',
  type: 'style',
  name: '测试串',
  description: '',
  tags: [],
  basePrompt: '',
  negativePrompt: '',
  modules: [],
  params: { ...DEFAULT_NAI_PARAMS },
  createdAt: 1,
  updatedAt: 1,
};

const currentUser: User = {
  id: 'u1',
  username: 'me',
  role: 'admin',
  createdAt: 1,
};

describe('ChainEditor 多角色', () => {
  it('手动坐标默认关闭；+角色弹出三选，选女性写入 girl, ', async () => {
    const user = userEvent.setup();
    render(
      <FeedbackProvider>
        <ChainEditor
          chain={chain}
          allChains={[chain]}
          currentUser={currentUser}
          onUpdateChain={vi.fn()}
          onBack={vi.fn()}
          onFork={vi.fn()}
          setIsDirty={vi.fn()}
          notify={vi.fn()}
        />
      </FeedbackProvider>,
    );

    expect(screen.getByRole('button', { name: '手动坐标' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('dialog', { name: '添加角色' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '+ 角色' }));
    expect(screen.getByRole('dialog', { name: '添加角色' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '女性' }));
    expect(screen.queryByRole('dialog', { name: '添加角色' })).toBeNull();
    expect(screen.getByLabelText('角色 1 提示词')).toHaveValue('girl, ');
    expect(screen.getByLabelText('Center X')).toBeDisabled();
  });
});
