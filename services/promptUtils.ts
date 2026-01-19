
import { PromptVersion } from '../types';

/**
 * Extracts variable names from a string (e.g., "{character}").
 */
export const extractVariables = (text: string): string[] => {
  const regex = /\{([a-zA-Z0-9_]+)\}/g;
  const matches = new Set<string>();
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.add(match[1]);
  }
  return Array.from(matches);
};

/**
 * Compiles the final prompt string by combining base, modules, and substituting variables.
 */
export const compilePrompt = (
  version: PromptVersion,
  variables: Record<string, string>,
  activeModulesOnly: boolean = true
): string => {
  let promptParts: string[] = [];

  // 1. Add Base Prompt
  if (version.basePrompt) promptParts.push(version.basePrompt);

  // 2. Add Modules
  if (version.modules) {
      version.modules.forEach((mod) => {
        if (!activeModulesOnly || mod.isActive) {
          promptParts.push(mod.content);
        }
      });
  }

  // 3. Join with commas (NAI style)
  let fullPrompt = promptParts.join(', ');

  // 4. Substitute Variables
  fullPrompt = fullPrompt.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    return variables[key] || ''; // Replace with value or empty string if missing
  });

  // 5. Cleanup (remove double commas, leading/trailing commas)
  fullPrompt = fullPrompt.replace(/,\s*,/g, ',').replace(/^,\s*/, '').replace(/,\s*$/, '');

  return fullPrompt;
};

/**
 * Identify all unique variables across base prompt and all modules
 */
export const getAllVariablesInVersion = (version: PromptVersion): string[] => {
  const allText = [
    version.basePrompt,
    ...(version.modules || []).map(m => m.content)
  ].join(' ');
  return extractVariables(allText);
};
