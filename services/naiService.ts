
import JSZip from 'jszip';
import { NAIParams } from '../types';
import { api } from './api';

export const generateImage = async (apiKey: string, prompt: string, negative: string, params: NAIParams) => {
  // Logic update: NAI API treats missing seed as random. 0 is a specific seed.
  // We pass seed only if it is a valid number and not -1 (our internal convention for random).
  let seed: number | undefined = undefined;
  if (params.seed !== undefined && params.seed !== null && params.seed !== -1) {
      seed = params.seed;
  }

  // Prepare Character Captions for V4.5
  const hasCharacters = params.characters && params.characters.length > 0;
  
  // 1. Positive Character Captions
  const charCaptions = hasCharacters ? params.characters!.map(c => ({
      char_caption: c.prompt,
      centers: [ { x: c.x, y: c.y } ]
  })) : [];

  // 2. Negative Character Captions (Structure must mirror positive)
  const charNegativeCaptions = hasCharacters ? params.characters!.map(c => ({
      char_caption: c.negativePrompt || "", // Use empty string placeholder if undefined
      centers: [ { x: c.x, y: c.y } ] // Coordinates mirrored
  })) : [];

  // 3. AI's Choice Logic: 
  // API param 'use_coords': false = AI Choice, true = Manual.
  // We default to true (manual) if characters exist for backward compatibility, unless explicitly set to false.
  const useCoords = params.useCoords ?? hasCharacters; 

  const payload: any = {
    input: prompt, // Keep flat input as fallback or for summary
    model: "nai-diffusion-4-5-full",
    action: "generate",
    parameters: {
      params_version: 3,
      width: params.width,
      height: params.height,
      scale: params.scale,
      sampler: params.sampler,
      steps: params.steps,
      n_samples: 1,
      
      // V4.5 Specifics
      qualityToggle: params.qualityToggle ?? true, // Default to true
      ucPreset: params.ucPreset ?? 0, // Default to 0 (Heavy)
      
      // New Features
      variety_boost: params.varietyBoost ?? false,
      cfg_rescale: params.cfgRescale ?? 0,

      // Legacy / Standard params
      sm: false,
      sm_dyn: false,
      dynamic_thresholding: false,
      controlnet_strength: 1,
      legacy: false,
      add_original_image: true,
      uncond_scale: 1,
      noise_schedule: "karras",
      negative_prompt: negative,
      // seed key is added conditionally below
      
      v4_prompt: {
        caption: {
          base_caption: prompt, // The compiled global prompt
          char_captions: charCaptions
        },
        use_coords: useCoords, // Controlled by UI toggle
        use_order: true
      },
      v4_negative_prompt: {
        caption: {
          base_caption: negative,
          char_captions: charNegativeCaptions
        },
        legacy_uc: false
      },
      
      deliberate_euler_ancestral_bug: false,
      prefer_brownian: true
    }
  };

  if (seed !== undefined) {
      payload.parameters.seed = seed;
  }

  // 调用 Worker Proxy, 传递 API Key Header
  const blob = await api.postBinary('/generate', payload, {
      'Authorization': `Bearer ${apiKey}`
  });

  // 解析 Zip (逻辑保持不变)
  const zip = await JSZip.loadAsync(blob);
  const filename = Object.keys(zip.files)[0];
  if (!filename) throw new Error("No image found in response");
  
  const fileData = await zip.files[filename].async('base64');
  return `data:image/png;base64,${fileData}`;
};