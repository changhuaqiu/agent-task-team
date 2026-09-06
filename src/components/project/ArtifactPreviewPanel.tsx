'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ArtifactPreview } from '@/shared/work-result';

const ERRORS: Record<string, string> = {
  preview_forbidden: '为保护项目和账号数据，此文件不能在应用内预览。',
  preview_unsupported: '暂不支持此格式的安全预览，请复制引用后在本地打开。',
  preview_too_large: '文件较大，无法内嵌预览，请复制引用后在本地打开。',
  preview_not_found: '未找到这份成果或本工作项接纳的证据引用。',
  preview_unavailable: '当前文件不存在、已移动或无法读取；登记记录仍保留。',
};
export function safeExternalUrl(ref: string): string | null {
  try { const url = new URL(ref); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function ArtifactPreviewPanel({ query }: { query: string }) {
  const [state, setState] = useState<{ query: string; preview?: ArtifactPreview; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/artifact-preview?' + query, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body as ArtifactPreview; })
      .then((preview) => { if (!controller.signal.aborted) setState({ query, preview }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ query, error: ERRORS[error.message] ?? '预览暂时无法读取，请关闭后重试。' }); });
    return () => controller.abort();
  }, [query]);
  if (state?.query !== query) return <p role="status" className="p-4 text-xs">正在读取预览…</p>;
  if (state.error) return <p role="alert" className="p-4 text-xs leading-5">{state.error}</p>;
  const preview = state.preview;
  if (!preview) return null;
  return <section aria-label="文件预览" className="mt-3 rounded-xl border border-[hsl(var(--border))] p-4">
    <p className="text-xs leading-5 text-[hsl(var(--text-tertiary))]">当前磁盘版本 · {new Date(preview.modifiedAt).toLocaleString('zh-CN')} · SHA-256 {preview.sha256.slice(0, 12)}<br />不等于验收时的冻结版本。{preview.kind === 'text' && preview.redacted ? ' 检测到的敏感值已遮蔽。' : ''}</p>
    <div className="mt-3 max-h-[500px] overflow-auto">
      {preview.kind === 'image'
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={preview.dataUrl} alt={preview.ref} className="max-w-full" />
        : /\.mdx?$/i.test(preview.ref)
          ? <div className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown components={{ img: ({ alt }) => <span>[图片：{alt}]</span>, a: ({ href, children }) => safeExternalUrl(href ?? '') ? <a href={safeExternalUrl(href!)!} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span> }}>{preview.content}</ReactMarkdown></div>
          : <pre className="whitespace-pre-wrap break-words text-xs leading-5">{preview.content}</pre>}
    </div>
  </section>;
}
