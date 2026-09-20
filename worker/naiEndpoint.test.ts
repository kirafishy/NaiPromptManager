import { describe, expect, it } from 'vitest';
import { resolveNaiEndpoint } from './naiEndpoint';

describe('resolveNaiEndpoint', () => {
  it('无 header 时回退到官方端点', () => {
    const req = new Request('https://example.com/api/generate', { method: 'POST' });
    expect(resolveNaiEndpoint(req, '/ai/generate-image')).toBe('https://image.novelai.net/ai/generate-image');
  });

  it('携带合法自定义端点时，正确拼接子路径', () => {
    const req = new Request('https://example.com/api/generate', {
      method: 'POST',
      headers: { 'x-custom-endpoint': 'https://my-proxy.com' },
    });
    expect(resolveNaiEndpoint(req, '/ai/generate-image')).toBe('https://my-proxy.com/ai/generate-image');
    expect(resolveNaiEndpoint(req, '/ai/generate-image-stream')).toBe('https://my-proxy.com/ai/generate-image-stream');
    expect(resolveNaiEndpoint(req, '/user/subscription')).toBe('https://my-proxy.com/user/subscription');
  });

  it('末尾斜杠和误带的子路径被自动清理', () => {
    const req = new Request('https://example.com/api/generate', {
      method: 'POST',
      headers: { 'x-custom-endpoint': 'https://my-proxy.com/ai/generate-image/' },
    });
    expect(resolveNaiEndpoint(req, '/ai/generate-image')).toBe('https://my-proxy.com/ai/generate-image');
  });

  it('非 http/https 协议回退到官方端点', () => {
    const req = new Request('https://example.com/api/generate', {
      method: 'POST',
      headers: { 'x-custom-endpoint': 'javascript:alert(1)' },
    });
    expect(resolveNaiEndpoint(req, '/ai/generate-image')).toBe('https://image.novelai.net/ai/generate-image');
  });

  it('非法 URL 字符串回退到官方端点', () => {
    const req = new Request('https://example.com/api/generate', {
      method: 'POST',
      headers: { 'x-custom-endpoint': 'invalid-url' },
    });
    expect(resolveNaiEndpoint(req, '/ai/generate-image')).toBe('https://image.novelai.net/ai/generate-image');
  });
});
