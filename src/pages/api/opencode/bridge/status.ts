import type { NextApiRequest } from 'next';
import type { NextApiResponse } from 'next';

function isPrivateHost(hostname: string) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split('.').map((x) => Number(x));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!url) {
    res.status(200).json({ available: false, error: '缺少 URL' });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.status(200).json({ available: false, error: 'URL 格式不正确' });
    return;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    res.status(200).json({ available: false, error: '仅支持 http/https' });
    return;
  }

  if (isPrivateHost(parsed.hostname)) {
    res.status(200).json({ available: false, error: '不允许使用内网/本机地址，请使用公网可访问 URL' });
    return;
  }

  const base = parsed.toString().replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  try {
    const r = await fetch(`${base}/health`, { method: 'GET', signal: controller.signal });
    const text = await r.text();
    const version = text.trim().slice(0, 120);
    if (!r.ok) {
      res.status(200).json({ available: false, error: `HTTP ${r.status}` });
      return;
    }
    res.status(200).json({ available: true, version: version || 'OK' });
  } catch (e) {
    res.status(200).json({ available: false, error: String((e as any)?.message || e) });
  } finally {
    clearTimeout(timer);
  }
}

