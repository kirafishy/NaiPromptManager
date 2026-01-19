// Core Data Models

export interface PromptChain {
  id: string;
  name: string;
  description: string;
  tags: string[];
  previewImage?: string; // Base64 or URL
  createdAt: number;
  updatedAt: number;
}

export interface PromptModule {
  id: string;
  name: string;
  content: string;
  isActive: boolean; // For testing toggle
}

export interface NAIParams {
  width: number;
  height: number;
  steps: number;
  scale: number; // CFG Scale
  sampler: string;
  seed?: number;
}

export interface PromptVersion {
  id: string;
  chainId: string;
  version: number;
  basePrompt: string;
  negativePrompt: string;
  modules: PromptModule[];
  params: NAIParams;
  createdAt: number;
}

// Composite type for UI
export interface ChainWithVersion extends PromptChain {
  latestVersion: PromptVersion | null;
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
  title: string;
  imageUrl: string; // Base64 Data URI
  prompt: string;
  createdAt: number;
}

// Global Env Type for Cloudflare/Runtime injection
declare global {
  interface Window {
    ENV?: {
      NAI_API_KEY?: string;
      MASTER_KEY?: string;
    };
  }
}
