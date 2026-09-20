export const OFFICIAL_NAI_BASE = 'https://image.novelai.net';

/**
 * 解析 NovelAI 请求目标完整 URL。
 * 若请求头携带 x-custom-endpoint 且为有效 http/https 协议，则使用自定义端点；
 * 否则使用官方端点。
 */
export function resolveNaiEndpoint(request: Request, subPath: string): string {
  const custom = request.headers.get('x-custom-endpoint')?.trim();
  if (!custom) {
    return `${OFFICIAL_NAI_BASE}${subPath}`;
  }

  try {
    const url = new URL(custom);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return `${OFFICIAL_NAI_BASE}${subPath}`;
    }

    let originAndPath = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    originAndPath = originAndPath
      .replace(/\/ai\/generate-image(-stream)?$/, '')
      .replace(/\/user\/subscription$/, '');

    const cleanBase = originAndPath.replace(/\/+$/, '');
    return `${cleanBase}${subPath}`;
  } catch {
    return `${OFFICIAL_NAI_BASE}${subPath}`;
  }
}
