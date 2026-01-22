
// Core Data Models

export type UserRole = 'admin' | 'user' | 'guest';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  createdAt: number;
  storageUsage?: number; // Bytes used
}

export interface PromptModule {
  id: string;
  name: string;
  content: string;
  isActive: boolean; // For testing toggle
  position?: 'pre' | 'post'; // New: Order control
}

export interface NAIParams {
  width: number;
  height: number;
  steps: number;
  scale: number; // CFG Scale
  sampler: string;
  seed?: number;
}

// Flattened Chain Structure (No more separate versions table)
export interface PromptChain {
  id: string;
  userId: string; // Owner
  username?: string; // Owner display name
  name: string;
  description: string;
  tags: string[];
  previewImage?: string; // Base64 or URL
  
  // Prompt Data (Formerly in Version)
  basePrompt: string;
  negativePrompt: string;
  modules: PromptModule[];
  params: NAIParams;
  
  // New: Persist variable inputs (Now used for the single Subject/Variable prompt)
  variableValues?: Record<string, string>;

  createdAt: number;
  updatedAt: number;
}

// Artist Library Types
export interface Artist {
  id: string;
  name: string;
  imageUrl: string; // Now supports Base64 Data URI
}

// Inspiration Gallery Types
export interface Inspiration {
  id: string;
  userId: string; // Owner
  username?: string;
  title: string;
  imageUrl: string; // Base64 Data URI
  prompt: string;
  createdAt: number;
}

// Local Generation History Item
export interface LocalGenItem {
    id: string;
    imageUrl: string; // Base64
    prompt: string;
    params: NAIParams;
    createdAt: number;
}

// Global Env Type for Cloudflare/Runtime injection
declare global {
  interface Window {
    ENV?: {
      MASTER_KEY?: string; // Legacy, kept for typing compatibility if needed
    };
  }
}
