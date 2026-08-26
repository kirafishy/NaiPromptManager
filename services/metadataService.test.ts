import { describe, expect, it } from 'vitest';
import { parseNovelAIMetadata } from './metadataService';
import { NAI_QUALITY_TAGS } from './promptUtils';

describe('parseNovelAIMetadata quality tags', () => {
  it('剥离末尾质量词', () => {
    const parsed = parseNovelAIMetadata(`{"prompt":"1girl${NAI_QUALITY_TAGS}","uc":""}`);
    expect(parsed.params.qualityToggle).toBe(true);
    expect(parsed.prompt).toBe('1girl');
  });

  it('质量词后面跟着 V5 teXt 块时仍识别并只剥质量词', () => {
    const raw = `{"prompt":"say \\"hi\\"${NAI_QUALITY_TAGS}, teXt: 你的姻缘线太浅\\n\\n我们天造地设","uc":""}`;
    const parsed = parseNovelAIMetadata(raw);
    expect(parsed.params.qualityToggle).toBe(true);
    expect(parsed.prompt).toBe('say "hi", teXt: 你的姻缘线太浅\n\n我们天造地设');
  });
});
