
import { PromptChain, Artist, Inspiration, User } from '../types';
import { api } from './api';

class DBService {
  // --- Auth ---
  async login(username: string, password: string): Promise<{success: boolean, user: User}> {
      return await api.post('/auth/login', { username, password });
  }

  async guestLogin(passcode: string): Promise<{success: boolean, user: User}> {
      return await api.post('/auth/guest-login', { passcode });
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

  async getUsers(): Promise<User[]> {
      return await api.get('/users');
  }

  async deleteUser(id: string): Promise<void> {
      await api.delete(`/users/${id}`);
  }

  // --- Admin: Guest Settings & Import ---
  async getGuestCode(): Promise<string> {
      const res = await api.get('/admin/guest-setting');
      return res.passcode;
  }

  async updateGuestCode(passcode: string): Promise<void> {
      await api.put('/admin/guest-setting', { passcode });
  }

  async importArtistFromGithub(name: string, url: string): Promise<void> {
      await api.post('/admin/import-github', { name, url });
  }

  // --- Chains ---
  async getAllChains(): Promise<PromptChain[]> {
    return await api.get('/chains');
  }

  async createChain(name: string, description: string, copyFrom?: PromptChain): Promise<string> {
    const payload: any = { name, description };
    if (copyFrom) {
        payload.basePrompt = copyFrom.basePrompt;
        payload.negativePrompt = copyFrom.negativePrompt;
        payload.modules = copyFrom.modules;
        payload.params = copyFrom.params;
        payload.previewImage = copyFrom.previewImage;
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
}

export const db = new DBService();
