
// Base API URL - 在开发模式可能需要指向 http://localhost:8787
const API_BASE = '/api';

const getHeaders = () => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  // 从本地存储或 Cookie 获取管理密钥
  // 简单起见，我们还是从 localStorage 读一个 key 用于鉴权
  const masterKey = localStorage.getItem('nai_master_key');
  if (masterKey) {
    headers['X-Master-Key'] = masterKey;
  }
  return headers;
};

export const api = {
  get: async (endpoint: string) => {
    const res = await fetch(`${API_BASE}${endpoint}`, { headers: getHeaders() });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  post: async (endpoint: string, data: any) => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  put: async (endpoint: string, data: any) => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  delete: async (endpoint: string) => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  
  // 专门用于二进制响应的请求 (NovelAI 图片)
  postBinary: async (endpoint: string, data: any) => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.blob();
  }
};
