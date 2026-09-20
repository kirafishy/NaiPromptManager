export const OFFICIAL_NAI_ENDPOINT = 'https://image.novelai.net';

export const CUSTOM_ENDPOINT_ENABLED_KEY = 'naipm_custom_endpoint_enabled';
export const CUSTOM_ENDPOINT_URL_KEY = 'naipm_custom_endpoint_url';
export const API_ENDPOINT_CHANGE_EVENT = 'naipm-api-endpoint-change';

let memoryEnabled: boolean | null = null;
let memoryEndpoint: string | null = null;
let hydrated = false;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function readStorage(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value !== null) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    /* 忽略配额超限或无权访问 */
  }
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;

  const storedEnabled = readStorage(CUSTOM_ENDPOINT_ENABLED_KEY);
  memoryEnabled = storedEnabled === 'true';

  const storedUrl = readStorage(CUSTOM_ENDPOINT_URL_KEY);
  memoryEndpoint = storedUrl ?? '';
}

/** 规范化 API 端点地址（去首尾空白、尾部斜杠及误粘的已知子路径） */
export function normalizeEndpoint(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';

  let cleaned = trimmed.replace(/\/+$/, '');
  cleaned = cleaned
    .replace(/\/ai\/generate-image(-stream)?$/, '')
    .replace(/\/user\/subscription$/, '');

  return cleaned.replace(/\/+$/, '');
}

/** 校验 URL 是否合法且为 http/https 协议 */
export function validateEndpoint(url: string): { valid: boolean; error?: string } {
  const trimmed = url.trim();
  if (!trimmed) {
    return { valid: false, error: '端点地址不能为空' };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: '端点必须以 http:// 或 https:// 开头' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: '请输入有效的网络地址 (URL)' };
  }
}

/** 是否启用了自定义端点 */
export function isCustomEndpointEnabled(): boolean {
  hydrate();
  return memoryEnabled ?? false;
}

/** 获取保存的自定义端点原始值 */
export function getCustomEndpoint(): string {
  hydrate();
  return memoryEndpoint ?? '';
}

/** 获取当前实际生效的 API 端点（如果未启用或未填写有效地址，返回官方端点） */
export function getEffectiveApiEndpoint(): string {
  hydrate();
  if (!memoryEnabled) {
    return OFFICIAL_NAI_ENDPOINT;
  }
  const custom = normalizeEndpoint(memoryEndpoint ?? '');
  if (!custom) {
    return OFFICIAL_NAI_ENDPOINT;
  }
  const check = validateEndpoint(custom);
  if (!check.valid) {
    return OFFICIAL_NAI_ENDPOINT;
  }
  return custom;
}

/** 设置是否开启自定义端点 */
export function setCustomEndpointEnabled(enabled: boolean): void {
  hydrate();
  memoryEnabled = enabled;
  writeStorage(CUSTOM_ENDPOINT_ENABLED_KEY, enabled ? 'true' : 'false');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(API_ENDPOINT_CHANGE_EVENT));
  }
  emit();
}

/** 设置自定义端点地址 */
export function setCustomEndpoint(url: string): void {
  hydrate();
  const normalized = normalizeEndpoint(url);
  memoryEndpoint = normalized;
  writeStorage(CUSTOM_ENDPOINT_URL_KEY, normalized);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(API_ENDPOINT_CHANGE_EVENT));
  }
  emit();
}

/** 统一设置自定义端点配置 */
export function setCustomEndpointConfig(config: { enabled: boolean; endpoint: string }): void {
  hydrate();
  memoryEnabled = config.enabled;
  const normalized = normalizeEndpoint(config.endpoint);
  memoryEndpoint = normalized;
  writeStorage(CUSTOM_ENDPOINT_ENABLED_KEY, config.enabled ? 'true' : 'false');
  writeStorage(CUSTOM_ENDPOINT_URL_KEY, normalized);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(API_ENDPOINT_CHANGE_EVENT));
  }
  emit();
}

/** 恢复为默认官方端点 */
export function resetCustomEndpoint(): void {
  hydrate();
  memoryEnabled = false;
  memoryEndpoint = '';
  writeStorage(CUSTOM_ENDPOINT_ENABLED_KEY, 'false');
  writeStorage(CUSTOM_ENDPOINT_URL_KEY, null);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(API_ENDPOINT_CHANGE_EVENT));
  }
  emit();
}

/** 订阅端点变化 */
export function subscribeApiEndpoint(listener: () => void): () => void {
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === CUSTOM_ENDPOINT_ENABLED_KEY || event.key === CUSTOM_ENDPOINT_URL_KEY) {
      hydrated = false;
      hydrate();
      listener();
    }
  };

  const handleCustom = () => {
    listener();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
    window.addEventListener(API_ENDPOINT_CHANGE_EVENT, handleCustom);
  }

  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(API_ENDPOINT_CHANGE_EVENT, handleCustom);
    }
  };
}
