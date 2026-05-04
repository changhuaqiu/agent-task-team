'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface MarkdownContentProps {
  content: string;
}

function CodeBlock({ className, children, ...props }: React.ComponentProps<'code'> & { children?: React.ReactNode }) {
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : null;

  if (!lang) {
    return (
      <code
        className="px-1.5 py-0.5 bg-[hsl(var(--bg-muted))] text-[hsl(var(--accent))] rounded-[2px] text-[11px] font-mono"
        {...props}
      >
        {children}
      </code>
    );
  }

  return <CodeBlockWithActions className={className} {...props}>{children}</CodeBlockWithActions>;
}

function CodeBlockWithActions({ className, children, ...props }: React.ComponentProps<'code'> & { children?: React.ReactNode }) {
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : '';
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = String(children).replace(/\n$/, '');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-[4px] overflow-hidden my-2">
      <div className="flex items-center justify-between px-3 py-1 bg-[#1A1625] border-b border-[#2A2435]">
        <span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider">{lang}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-[#94A3B8] hover:text-white transition-colors p-0.5"
          title="Copy code"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <div className="overflow-x-auto">
        <code className={className} {...props}>
          {children}
        </code>
      </div>
    </div>
  );
}

function renderTextWithMentions(text: string): React.ReactNode[] {
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return (
        <span
          key={i}
          className="inline-block px-1 bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))] rounded-[2px] font-bold mx-0.5"
        >
          {part}
        </span>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

function MentionParagraph({ children, ...props }: React.ComponentProps<'p'> & { children?: React.ReactNode }) {
  const processed = React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return <>{renderTextWithMentions(child)}</>;
    }
    return child;
  });

  return <p {...props}>{processed}</p>;
}

function MentionListItem({ children, ...props }: React.ComponentProps<'li'> & { children?: React.ReactNode }) {
  const processed = React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return <>{renderTextWithMentions(child)}</>;
    }
    return child;
  });

  return <li {...props}>{processed}</li>;
}

function MentionTableCell({ children, ...props }: React.ComponentProps<'td'> & { children?: React.ReactNode }) {
  const processed = React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return <>{renderTextWithMentions(child)}</>;
    }
    return child;
  });

  return <td {...props}>{processed}</td>;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="markdown-body prose prose-sm prose-invert max-w-none text-[12px] leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-[14px] [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-[13px] [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-[12px] [&_h3]:mt-1.5 [&_h3]:mb-0.5 [&_blockquote]:my-1 [&_pre]:bg-[#1A1625] [&_pre]:rounded-[4px] [&_table]:text-[11px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code: CodeBlock as any,
          p: MentionParagraph,
          li: MentionListItem,
          td: MentionTableCell as any,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-[hsl(var(--accent))] underline hover:brightness-125">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
