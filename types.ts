
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

export interface CharacterParams {
  id: string;
  prompt: string;
  negativePrompt?: string; // New: Per-character negative prompt
  x: number; // 0.0 to 1.0
  y: number; // 0.0 to 1.0
}

export interface NAIParams {
  width: number;
  height: number;
  steps: number;
  scale: number; // CFG Scale
  sampler: string;
  seed?: number;
  // V4.5 Specifics
  qualityToggle?: boolean; // Default true
  ucPreset?: number; // 0: Heavy, 1: Light, 2: None
  characters?: CharacterParams[]; // Multi-character support
  
  // New Features
  useCoords?: boolean; // true = Manual Coords, false = AI's Choice
  varietyBoost?: boolean; // Variety+
  cfgRescale?: number; // Prompt Guidance Rescale (0.0 - 1.0)
}

export type ChainType = 'style' | 'character';

// Flattened Chain Structure (No more separate versions table)
export interface PromptChain {
  id: string;
  userId: string; // Owner
  username?: string; // Owner display name
  type: ChainType; // New: Distinguish between Style (Artist) and Character chains
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
  imageUrl: string; // Original (Danbooru) image
  previewUrl?: string; // Legacy: Single benchmark
  benchmarks?: string[]; // New: Array of 3 benchmark images [Face, Body, Scene]
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