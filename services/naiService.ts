

import JSZip from 'jszip';
import { NAIParams } from '../types';
import { api } from './api';

export const generateImage = async (apiKey: string, prompt: string, negative: string, params: NAIParams) => {
  const seed = params.seed ?? Math.floor(Math.random() * 4294967295);

  const payload = {
    input: prompt,
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
      ucPreset: 0,
      qualityToggle: true,
      sm: false,
      sm_dyn: false,
      dynamic_thresholding: false,
      controlnet_strength: 1,
      legacy: false,
      add_original_image: true,
      uncond_scale: 1,
      cfg_rescale: 0,
      noise_schedule: "karras",
      negative_prompt: negative,
      seed: seed,
      
      v4_prompt: {
        caption: {
          base_caption: prompt,
          char_captions: []
        },
        use_coords: false,
        use_order: true
      },
      v4_negative_prompt: {
        caption: {
          base_caption: negative,
          char_captions: []
        },
        legacy_uc: false
      },
      
      deliberate_euler_ancestral_bug: false,
      prefer_brownian: true
    }
  };

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
