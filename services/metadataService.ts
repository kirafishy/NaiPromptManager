/**
 * Simple PNG Metadata Parser for NAI Images
 * Reads tEXt chunks to find generation data.
 */

export const extractMetadata = async (file: File): Promise<string | null> => {
  if (file.type !== 'image/png') {
    console.warn('Only PNG metadata is supported currently.');
    return null;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const text = readPngTextChunks(arrayBuffer);
    if (!text) return null;

    return parseNaiGenerationData(text);
  } catch (e) {
    console.error('Failed to parse metadata', e);
    return null;
  }
};

const readPngTextChunks = (buffer: ArrayBuffer): string | null => {
  const data = new DataView(buffer);
  
  // Check PNG Signature: 89 50 4E 47 0D 0A 1A 0A
  if (data.getUint32(0) !== 0x89504E47 || data.getUint32(4) !== 0x0D0A1A0A) {
    return null;
  }

  let offset = 8;
  const decoder = new TextDecoder('iso-8859-1'); // PNG tEXt is mostly ISO-8859-1

  while (offset < data.byteLength) {
    // Read Chunk Length
    const length = data.getUint32(offset);
    offset += 4;

    // Read Chunk Type
    const type = decoder.decode(new Uint8Array(buffer, offset, 4));
    offset += 4;

    // We only care about 'tEXt' chunks
    if (type === 'tEXt') {
      const chunkData = new Uint8Array(buffer, offset, length);
      // tEXt format: Keyword + Null Separator + Text
      let nullIndex = -1;
      for (let i = 0; i < length; i++) {
        if (chunkData[i] === 0) {
          nullIndex = i;
          break;
        }
      }

      if (nullIndex > -1) {
        const keyword = decoder.decode(chunkData.slice(0, nullIndex));
        // Common NAI keywords: 'Description', 'Comment', 'Software', 'Source'
        // But usually the prompt data is in 'Description' or 'Comment'
        if (keyword === 'Description' || keyword === 'Comment') {
            const content = decoder.decode(chunkData.slice(nullIndex + 1));
            // Check if it looks like NAI data
            if (content.includes('Steps:') || content.includes('"prompt":')) {
                return content;
            }
        }
      }
    }

    // Move to next chunk (Data Length + CRC 4 bytes)
    offset += length + 4;
  }

  return null;
};

const parseNaiGenerationData = (text: string): string => {
  // 1. Handle JSON format (some newer versions or tools)
  if (text.trim().startsWith('{')) {
    try {
      const json = JSON.parse(text);
      if (json.prompt) return json.prompt;
      if (json.input) return json.input; // API payload style
    } catch (e) {
      // Ignore JSON error, try text parsing
    }
  }

  // 2. Handle Standard NAI Text Format
  // Format usually: "Prompt text... \n Negative prompt: ... \n Steps: ..."
  let cleanText = text;

  // Find end of prompt
  const negIndex = cleanText.indexOf('Negative prompt:');
  const stepsIndex = cleanText.indexOf('Steps:');
  const ucIndex = cleanText.indexOf('Undesired Content:'); // Legacy

  let cutoff = cleanText.length;

  if (negIndex !== -1 && negIndex < cutoff) cutoff = negIndex;
  if (stepsIndex !== -1 && stepsIndex < cutoff) cutoff = stepsIndex;
  if (ucIndex !== -1 && ucIndex < cutoff) cutoff = ucIndex;

  const prompt = cleanText.substring(0, cutoff).trim();
  
  // Remove trailing comma if exists
  return prompt.replace(/,\s*$/, '');
};
