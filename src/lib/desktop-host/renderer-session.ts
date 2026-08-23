export const DESKTOP_RENDERER_SESSION_HEADER = 'x-ath-renderer-session';

export function readDesktopRendererSessionToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const token = new URLSearchParams(window.location.hash.slice(1)).get('ath-desktop-session');
  return token?.trim() || undefined;
}
