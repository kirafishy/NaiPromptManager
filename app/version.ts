export const APP_VERSION = '1.4.0';
export const APP_REPO_URL = 'https://github.com/kirafishy/NaiPromptManager';
export const APP_DISCORD_URL = 'https://discord.com/channels/1134557553011998840/1469376867101311148/1469376867101311148';
export const APP_NAME = 'NAI 咒语构建终端';

export function repoDisplayName(url: string = APP_REPO_URL): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    const parts = path.split('/').filter(Boolean);
    return parts[parts.length - 1] || url;
  } catch {
    return url;
  }
}
