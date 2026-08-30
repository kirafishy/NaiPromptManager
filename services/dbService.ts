
import { userListQueryString } from '../config/userListQuery';
import { PromptChain, Artist, Inspiration, User, ChainType, UsageStats, VibePreset, SharedVibeListItem } from '../types';
import { api } from './api';

export type UserListPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type UserListResult = {
  data: User[];
  pagination: UserListPagination;
};

export type UserListRequest = {
  page?: number;
  pageSize?: number;
  q?: string;
  role?: string;
};

class DBService {
  // --- Auth ---
  async login(username: string, password: string): Promise<{ success: boolean, user: User }> {
    return await api.post('/auth/login', { username, password });
  }

  async logout(): Promise<void> {
    await api.post('/auth/logout', {});
  }

  async getMe(): Promise<User> {
    return await api.get('/auth/me');
  }

  async updatePassword(password: string): Promise<void> {
    await api.put('/users/password', { password });
  }

  // --- Global Settings (Config) ---
  async getBenchmarkConfig(): Promise<any> {
    const res = await api.get('/config/benchmarks');
    return res.config;
  }

  async saveBenchmarkConfig(config: any): Promise<void> {
    await api.put('/config/benchmarks', { config });
  }

  // --- Users (Admin) ---
  async createUser(username: string, password: string): Promise<void> {
    await api.post('/users', { username, password });
  }

  async getUsers(opts: UserListRequest = {}): Promise<UserListResult> {
    const res = await api.get(`/users?${userListQueryString(opts)}`);
    if (Array.isArray(res)) {
      return {
        data: res,
        pagination: { page: 1, pageSize: res.length, total: res.length, totalPages: res.length ? 1 : 0 },
      };
    }
    const data = Array.isArray(res?.data) ? res.data : [];
    const pagination = res?.pagination || {};
    return {
      data,
      pagination: {
        page: Number(pagination.page) || 1,
        pageSize: Number(pagination.pageSize) || data.length || 20,
        total: Number(pagination.total) || data.length,
        totalPages: Number(pagination.totalPages) || 0,
      },
    };
  }

  async deleteUser(id: string): Promise<void> {
    await api.delete(`/users/${id}`);
  }

  async updateUserQuota(userId: string, maxStorage: number): Promise<void> {
    await api.put(`/users/${userId}/quota`, { maxStorage });
  }

  async updateUserRole(userId: string, role: string, resetQuota = false): Promise<{ success: boolean; role: string; maxStorage: number }> {
    return await api.put(`/users/${userId}/role`, { role, resetQuota });
  }

  async demoteStaleUsers(): Promise<{ success: boolean; count: number }> {
    return await api.post('/users/demote-stale', {});
  }

  // --- Admin: Import ---
  async importArtistFromGithub(name: string, url: string): Promise<void> {
    await api.post('/admin/import-github', { name, url });
  }

  // --- Chains ---
  async getAllChains(): Promise<PromptChain[]> {
    return await api.get('/chains');
  }

  async createChain(name: string, description: string, copyFrom?: PromptChain, type: ChainType = 'style'): Promise<string> {
    const payload: any = { name, description, type, isPrivate: false };
    if (copyFrom) {
      payload.basePrompt = copyFrom.basePrompt;
      payload.negativePrompt = copyFrom.negativePrompt;
      payload.modules = copyFrom.modules;
      payload.params = copyFrom.params;
      payload.previewImage = copyFrom.previewImage;
      // Don't copy type if it's explicitly passed, otherwise assume same type
      if (!type && copyFrom.type) payload.type = copyFrom.type;

      // Copy variable values as well to preserve the subject
      payload.variableValues = copyFrom.variableValues;
      // Copy tags from the source chain
      payload.tags = copyFrom.tags || [];
      // Fork 默认创建为公开串，避免把私人状态意外扩散到新串
    } else {
      // Create Default Modules for new chain
      payload.modules = [];

      // Default Subject for NEW chains is '1girl'.
      // User can clear this in editor (it will save as "" string), avoiding forced reset.
      payload.variableValues = { subject: '1girl' };
      // Initialize with empty tags
      payload.tags = [];
    }
    const res = await api.post('/chains', payload);
    return res.id;
  }

  async updateChain(id: string, updates: Partial<PromptChain>): Promise<void> {
    await api.put(`/chains/${id}`, updates);
  }

  async deleteChain(id: string): Promise<void> {
    await api.delete(`/chains/${id}`);
  }

  // --- Artists ---
  async getAllArtists(): Promise<Artist[]> {
    return await api.get('/artists');
  }

  async saveArtist(artist: Artist): Promise<void> {
    await api.post('/artists', artist);
  }

  async deleteArtist(id: string): Promise<void> {
    await api.delete(`/artists/${id}`);
  }

  // --- Inspirations ---
  async getAllInspirations(): Promise<Inspiration[]> {
    return await api.get('/inspirations');
  }

  async saveInspiration(inspiration: Inspiration): Promise<void> {
    await api.post('/inspirations', inspiration);
  }

  async updateInspiration(id: string, updates: Partial<Inspiration>): Promise<void> {
    await api.put(`/inspirations/${id}`, updates);
  }

  async deleteInspiration(id: string): Promise<void> {
    await api.delete(`/inspirations/${id}`);
  }

  async bulkDeleteInspirations(ids: string[]): Promise<void> {
    await api.post('/inspirations/bulk-delete', { ids });
  }

  // --- Admin: Usage Statistics ---
  async getUsageStats(): Promise<UsageStats> {
    return await api.get('/admin/stats');
  }

  async clearOldLogs(): Promise<void> {
    await api.post('/admin/clear-logs', {});
  }

  async listSharedVibes(): Promise<SharedVibeListItem[]> {
    const res = await api.get('/vibes');
    return Array.isArray(res) ? res : (res.data || []);
  }

  async getSharedVibe(id: string): Promise<VibePreset> {
    return await api.get(`/vibes/${encodeURIComponent(id)}`);
  }

  async shareVibe(localId: string, preset: VibePreset): Promise<{ id: string }> {
    return await api.post('/vibes', { localId, sharedId: preset.sharedId, preset });
  }

  async unshareVibe(id: string): Promise<void> {
    await api.delete(`/vibes/${encodeURIComponent(id)}`);
  }
}

export const db = new DBService();
