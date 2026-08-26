import type { NAIParams, ResolvedVibe } from '../types';
import { isV5Model, resolveNaiModel, withTransparentTags } from './naiModels';
import { NAI_QUALITY_TAGS, NAI_UC_PRESETS } from './promptUtils';

/** 官网已手写 `Text:` / `teXt:` 时不再自动抽取引号。 */
const HAS_TEXT_BLOCK = /(?:^|[\n,])\s*text\s*:/i;

/** ASCII、中文弯引号、全角引号、直角引号。 */
const QUOTED_TEXT = /"([^"\n]+)"|「([^」\n]+)」|『([^』\n]+)』|“([^”\n]+)”|‘([^’\n]+)’|＂([^＂\n]+)＂/g;

/**
 * V5 官网会把引号里的句子提升成末尾的 `teXt:` 块，否则质量词里的 `no text`
 * 会把对话框打成乱码。多段之间空一行；引号出现顺序会倒过来（末句在上），
 * 因为 `teXt:` 第一行渲染在画面顶部。已有 Text 块则原样返回。
 */
export const applyV5AutoText = (prompt: string): string => {
  if (HAS_TEXT_BLOCK.test(prompt)) return prompt;
  const quoted: string[] = [];
  QUOTED_TEXT.lastIndex = 0;
  for (const match of prompt.matchAll(QUOTED_TEXT)) {
    const text = match.slice(1).find(Boolean)?.trim() ?? '';
    if (text) quoted.push(text);
  }
  if (quoted.length === 0) return prompt;
  return `${prompt}, teXt: ${quoted.reverse().join('\n\n')}`;
};

interface NAICharCaption {
  char_caption: string;
  centers: Array<{ x: number; y: number }>;
}

export interface NAIImageGenerationParameters {
  params_version: number;
  width: number;
  height: number;
  scale: number;
  sampler: string;
  steps: number;
  n_samples: number;
  skip_cfg_above_sigma: number | null;
  cfg_rescale: number;
  qualityToggle: boolean;
  ucPreset: number;
  sm: boolean;
  sm_dyn: boolean;
  dynamic_thresholding: boolean;
  controlnet_strength: number;
  legacy: boolean;
  add_original_image: boolean;
  uncond_scale: number;
  noise_schedule: string;
  negative_prompt: string;
  seed?: number;
  v4_prompt: {
    caption: {
      base_caption: string;
      char_captions: NAICharCaption[];
    };
    use_coords: boolean;
    use_order: boolean;
  };
  v4_negative_prompt: {
    caption: {
      base_caption: string;
      char_captions: NAICharCaption[];
    };
    legacy_uc: boolean;
  };
  deliberate_euler_ancestral_bug: boolean;
  prefer_brownian: boolean;
  reference_image_multiple?: string[];
  reference_strength_multiple?: number[];
  reference_information_extracted_multiple?: number[];
  stream?: 'sse' | 'msgpack';
  straight_alpha?: boolean;
  tag_hint_transparent_background?: boolean;
  tag_hint_qt?: number;
}

export interface NAIImageGenerationPayload {
  input: string;
  model: string;
  action: 'generate';
  parameters: NAIImageGenerationParameters;
}

export const buildGenerationPayload = (
  prompt: string,
  negative: string,
  params: NAIParams,
  vibes: ResolvedVibe[] = [],
): NAIImageGenerationPayload => {
  const seed = params.seed !== undefined && params.seed !== null && params.seed !== -1
    ? params.seed
    : undefined;

  const model = resolveNaiModel(params);
  const v5 = isV5Model(params);
  const useTransparent = v5 && !!params.transparent;

  let finalPrompt = prompt;
  if (useTransparent) finalPrompt = withTransparentTags(finalPrompt);
  if (params.qualityToggle ?? true) {
    finalPrompt += NAI_QUALITY_TAGS;
  }
  if (v5) finalPrompt = applyV5AutoText(finalPrompt);

  let finalNegative = negative;
  const presetId = params.ucPreset ?? 0;
  if (presetId !== 4) {
    const presetString = NAI_UC_PRESETS[presetId as keyof typeof NAI_UC_PRESETS];
    if (presetString) finalNegative = presetString + finalNegative;
  }

  const characters = params.characters ?? [];
  const charCaptions = characters.map(character => ({
    char_caption: character.prompt,
    centers: [{ x: character.x, y: character.y }],
  }));
  const charNegativeCaptions = characters.map(character => ({
    char_caption: character.negativePrompt || '',
    centers: [{ x: character.x, y: character.y }],
  }));

  const parameters: NAIImageGenerationParameters = {
    params_version: v5 ? 4 : 3,
    width: params.width,
    height: params.height,
    scale: params.scale,
    sampler: params.sampler,
    steps: params.steps,
    n_samples: 1,
    skip_cfg_above_sigma: params.variety ? 58 : null,
    cfg_rescale: params.cfgRescale ?? 0,
    qualityToggle: params.qualityToggle ?? true,
    ucPreset: params.ucPreset ?? 0,
    sm: false,
    sm_dyn: false,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    legacy: false,
    add_original_image: true,
    uncond_scale: 1,
    noise_schedule: 'karras',
    negative_prompt: finalNegative,
    v4_prompt: {
      caption: {
        base_caption: finalPrompt,
        char_captions: charCaptions,
      },
      use_coords: params.useCoords ?? false,
      use_order: true,
    },
    v4_negative_prompt: {
      caption: {
        base_caption: finalNegative,
        char_captions: charNegativeCaptions,
      },
      legacy_uc: false,
    },
    deliberate_euler_ancestral_bug: false,
    prefer_brownian: true,
  };

  if (params.stream) parameters.stream = 'sse';
  if (v5 && (params.qualityToggle ?? true)) parameters.tag_hint_qt = 1;
  if (useTransparent) {
    parameters.tag_hint_transparent_background = true;
    parameters.straight_alpha = params.alphaMode !== 'premultiplied';
  }

  if (seed !== undefined) parameters.seed = seed;
  if (vibes.length > 0) {
    parameters.reference_image_multiple = vibes.map(vibe => vibe.encoding);
    parameters.reference_strength_multiple = vibes.map(vibe => vibe.strength);
    parameters.reference_information_extracted_multiple = vibes.map(vibe => vibe.informationExtracted);
  }

  return {
    input: finalPrompt,
    model,
    action: 'generate',
    parameters,
  };
};
