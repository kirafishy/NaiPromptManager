// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddCharacterPicker, CHARACTER_ADD_PRESETS } from './AddCharacterPicker';

afterEach(cleanup);

describe('AddCharacterPicker', () => {
  it('三选项对应 girl, / boy, / 空 prompt', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onClose = vi.fn();

    render(<AddCharacterPicker open onClose={onClose} onPick={onPick} />);

    expect(screen.getByRole('dialog', { name: '添加角色' })).toBeInTheDocument();
    expect(CHARACTER_ADD_PRESETS.map((p) => p.prompt)).toEqual(['girl, ', 'boy, ', '']);

    await user.click(screen.getByRole('button', { name: '女性' }));
    expect(onPick).toHaveBeenCalledWith('girl, ');

    onPick.mockClear();
    await user.click(screen.getByRole('button', { name: '男性' }));
    expect(onPick).toHaveBeenCalledWith('boy, ');

    onPick.mockClear();
    await user.click(screen.getByRole('button', { name: '其他' }));
    expect(onPick).toHaveBeenCalledWith('');
  });
});
