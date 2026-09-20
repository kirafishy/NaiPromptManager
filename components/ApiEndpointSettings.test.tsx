// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiEndpointSettings } from './ApiEndpointSettings';
import * as endpointStore from '../services/apiEndpointStore';

afterEach(cleanup);

describe('ApiEndpointSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    endpointStore.resetCustomEndpoint();
  });

  it('默认显示官方端点说明，开关处于关闭状态，不展示输入框', () => {
    render(<ApiEndpointSettings />);

    expect(screen.getByRole('heading', { name: 'API 端点' })).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: '自定义端点' });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/默认使用官方 API 端点/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '自定义 API 地址' })).toBeNull();
  });

  it('打开自定义开关后，展开自定义 API 地址输入框并可配置保存', async () => {
    const user = userEvent.setup();
    render(<ApiEndpointSettings />);

    const toggle = screen.getByRole('switch', { name: '自定义端点' });
    await user.click(toggle);

    expect(toggle).toBeChecked();
    const input = screen.getByRole('textbox', { name: '自定义 API 地址' });
    expect(input).toBeInTheDocument();

    await user.type(input, 'https://proxy.example.com');
    await user.click(screen.getByRole('button', { name: '保存端点' }));

    await waitFor(() => {
      expect(screen.getByText('已保存自定义端点')).toBeInTheDocument();
    });

    expect(endpointStore.isCustomEndpointEnabled()).toBe(true);
    expect(endpointStore.getEffectiveApiEndpoint()).toBe('https://proxy.example.com');
  });

  it('输入非法 URL 时给出错误提示且不生效', async () => {
    const user = userEvent.setup();
    render(<ApiEndpointSettings />);

    const toggle = screen.getByRole('switch', { name: '自定义端点' });
    await user.click(toggle);

    const input = screen.getByRole('textbox', { name: '自定义 API 地址' });
    await user.type(input, 'not-a-valid-url');
    await user.click(screen.getByRole('button', { name: '保存端点' }));

    expect(screen.getByText(/请输入有效的网络地址/)).toBeInTheDocument();
    expect(endpointStore.getEffectiveApiEndpoint()).toBe('https://image.novelai.net');
  });

  it('点击恢复默认后，重置为官方默认端点并关闭开关', async () => {
    const user = userEvent.setup();
    endpointStore.setCustomEndpointConfig({
      enabled: true,
      endpoint: 'https://proxy.example.com',
    });

    render(<ApiEndpointSettings />);
    const toggle = screen.getByRole('switch', { name: '自定义端点' });
    expect(toggle).toBeChecked();

    await user.click(screen.getByRole('button', { name: '恢复默认' }));

    expect(toggle).not.toBeChecked();
    expect(endpointStore.isCustomEndpointEnabled()).toBe(false);
    expect(endpointStore.getEffectiveApiEndpoint()).toBe('https://image.novelai.net');
    expect(screen.getByText(/默认使用官方 API 端点/)).toBeInTheDocument();
  });

  it('关闭自定义开关后，立即回退为官方默认端点', async () => {
    const user = userEvent.setup();
    endpointStore.setCustomEndpointConfig({
      enabled: true,
      endpoint: 'https://proxy.example.com',
    });

    render(<ApiEndpointSettings />);
    const toggle = screen.getByRole('switch', { name: '自定义端点' });
    expect(toggle).toBeChecked();

    await user.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(endpointStore.getEffectiveApiEndpoint()).toBe('https://image.novelai.net');
    expect(screen.getByText(/默认使用官方 API 端点/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '自定义 API 地址' })).toBeNull();
  });
});
