import type { NAIModelId, NAIParams } from '../types';

export const NAI_MODELS = {
  V4_5_FULL: 'nai-diffusion-4-5-full',
  V5_FULL: 'nai-diffusion-5-full',
} as const satisfies Record<string, NAIModelId>;

export const NAI_MODEL_OPTIONS: Array<{ id: NAIModelId; label: string }> = [
  { id: NAI_MODELS.V4_5_FULL, label: 'V4.5' },
  { id: NAI_MODELS.V5_FULL, label: 'V5' },
];

/** 旧 Chain 没有 model 字段时保持 V4.5，避免悄悄换模型。 */
export function resolveNaiModel(params?: Pick<NAIParams, 'model'> | null): NAIModelId {
  if (params?.model === NAI_MODELS.V5_FULL || params?.model === NAI_MODELS.V4_5_FULL) {
    return params.model;
  }
  return NAI_MODELS.V4_5_FULL;
}

export function isV5Model(params?: Pick<NAIParams, 'model'> | null): boolean {
  return resolveNaiModel(params) === NAI_MODELS.V5_FULL;
}

export const NAI_TRANSPARENT_TAGS = 'transparent background, has alpha';

export function withTransparentTags(prompt: string): string {
  if (/\btransparent background\b/i.test(prompt)) return prompt;
  return prompt ? `${prompt}, ${NAI_TRANSPARENT_TAGS}` : NAI_TRANSPARENT_TAGS;
}

/** 官网 97% ≈ 1678 张校准。 */
export const OPUS_V5_IMAGES_PER_PERCENT = 17.3;

export const DEFAULT_NAI_PARAMS: NAIParams = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  seed: undefined,
  qualityToggle: true,
  ucPreset: 4,
  characters: [],
  useCoords: false,
  model: NAI_MODELS.V4_5_FULL,
  stream: false,
  transparent: false,
  alphaMode: 'straight',
};
