
import { PromptChain, PromptVersion, ChainWithVersion, Artist, Inspiration } from '../types';
import { api } from './api';

class DBService {
  // --- Chains ---
  async getAllChains(): Promise<ChainWithVersion[]> {
    return await api.get('/chains');
  }

  async getChainById(id: string): Promise<ChainWithVersion | null> {
    const chains = await this.getAllChains();
    return chains.find(c => c.id === id) || null;
  }

  async createChain(name: string, description: string): Promise<string> {
    const res = await api.post('/chains', { name, description });
    return res.id;
  }

  async updateChain(id: string, updates: Partial<PromptChain>): Promise<void> {
    await api.put(`/chains/${id}`, updates);
  }

  async deleteChain(id: string): Promise<void> {
    await api.delete(`/chains/${id}`);
  }

  // --- Versions ---
  async saveNewVersion(chainId: string, data: Partial<PromptVersion>): Promise<PromptVersion> {
    // 后端会自动处理版本号递增逻辑
    return await api.post(`/chains/${chainId}/versions`, data);
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

  async deleteInspiration(id: string): Promise<void> {
    await api.delete(`/inspirations/${id}`);
  }
}

export const db = new DBService();
