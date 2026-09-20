import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe('apiEndpointStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('默认状态：未开启自定义端点，生效端点为官方端点', async () => {
    const store = await import('./apiEndpointStore');
    expect(store.isCustomEndpointEnabled()).toBe(false);
    expect(store.getCustomEndpoint()).toBe('');
    expect(store.getEffectiveApiEndpoint()).toBe('https://image.novelai.net');
  });

  it('开启自定义开关并配置有效端点，生效端点为自定义端点', async () => {
    const store = await import('./apiEndpointStore');
    store.setCustomEndpointEnabled(true);
    store.setCustomEndpoint('https://my-proxy.novelai.example.com');

    expect(store.isCustomEndpointEnabled()).toBe(true);
    expect(store.getCustomEndpoint()).toBe('https://my-proxy.novelai.example.com');
    expect(store.getEffectiveApiEndpoint()).toBe('https://my-proxy.novelai.example.com');
  });

  it('规范化：自动剥离末尾斜杠和多余子路径', async () => {
    const store = await import('./apiEndpointStore');
    expect(store.normalizeEndpoint('https://proxy.com/')).toBe('https://proxy.com');
    expect(store.normalizeEndpoint('https://proxy.com/ai/generate-image/')).toBe('https://proxy.com');
    expect(store.normalizeEndpoint('https://proxy.com/ai/generate-image-stream')).toBe('https://proxy.com');
    expect(store.normalizeEndpoint('https://proxy.com/user/subscription')).toBe('https://proxy.com');
  });

  it('开启自定义开关但未填写有效地址时，回退到官方默认端点', async () => {
    const store = await import('./apiEndpointStore');
    store.setCustomEndpointEnabled(true);
    store.setCustomEndpoint('not-a-valid-url');

    expect(store.isCustomEndpointEnabled()).toBe(true);
    expect(store.getEffectiveApiEndpoint()).toBe('https://image.novelai.net');
  });

  it('关闭自定义开关时，即使存有自定义端点，生效端点依然回退到官方端点', async () => {
    const store = await import('./apiEndpointStore');
    store.setCustomEndpointConfig({
      enabled: true,
      endpoint: 'https://my-proxy.example.com',
    });
    expect(store.getEffectiveApiEndpoint()).toBe('https://my-proxy.example.com');

    store.setCustomEndpointEnabled(false);
    expect(store.isCustomEndpointEnabled()).toBe(false);
    expect(store.getCustomEndpoint()).toBe('https://my-proxy.example.com');
    expect(store.getEffectiveApiEndpoint()).toBe('https://image.novelai.net');
  });

  it('resetCustomEndpoint 重置为官方默认端点', async () => {
    const store = await import('./apiEndpointStore');
    store.setCustomEndpointConfig({
      enabled: true,
      endpoint: 'https://my-proxy.example.com',
    });
    store.resetCustomEndpoint();

    expect(store.isCustomEndpointEnabled()).toBe(false);
    expect(store.getCustomEndpoint()).toBe('');
    expect(store.getEffectiveApiEndpoint()).toBe('https://image.novelai.net');
  });

  it('hydrate 能正确从 localStorage 读取初始值', async () => {
    localStorage.setItem('naipm_custom_endpoint_enabled', 'true');
    localStorage.setItem('naipm_custom_endpoint_url', 'https://stored-proxy.com');

    const store = await import('./apiEndpointStore');
    expect(store.isCustomEndpointEnabled()).toBe(true);
    expect(store.getCustomEndpoint()).toBe('https://stored-proxy.com');
    expect(store.getEffectiveApiEndpoint()).toBe('https://stored-proxy.com');
  });
});
