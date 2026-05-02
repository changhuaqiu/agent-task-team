# Chat Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render agent replies as formatted Markdown instead of plain text.

**Architecture:** Install react-markdown + remark-gfm + rehype-highlight + highlight.js + @tailwindcss/typography. Create a `MarkdownContent` component that wraps ReactMarkdown with custom renderers. Branch `ChatMessageItem` to use MarkdownContent for agent messages and keep plain text for human messages.

**Tech Stack:** React, react-markdown, Tailwind CSS v4, @tailwindcss/typography

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

Run:
```bash
npm install react-markdown remark-gfm rehype-highlight highlight.js @tailwindcss/typography
```

- [ ] **Step 2: Verify installation**

Run: `grep -E "react-markdown|remark-gfm|rehype-highlight|highlight.js|@tailwindcss/typography" package.json`
Expected: All 5 packages listed in dependencies.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add markdown rendering dependencies

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Register typography plugin and customize prose colors

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add typography plugin import**

In `src/app/globals.css`, after the existing `@import "tailwindcss";` on line 1, add:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";
```

- [ ] **Step 2: Add prose color overrides**

Add a new section at the end of the file (after the animations block), customizing prose to match the project's HSL theme tokens:

```css
/* --- Markdown Prose Overrides --- */
.markdown-body {
  --tw-prose-body: hsl(var(--text-primary));
  --tw-prose-headings: hsl(var(--text-primary));
  --tw-prose-lead: hsl(var(--text-secondary));
  --tw-prose-links: hsl(var(--accent));
  --tw-prose-bold: hsl(var(--text-primary));
  --tw-prose-counters: hsl(var(--text-secondary));
  --tw-prose-bullets: hsl(var(--text-tertiary));
  --tw-prose-hr: hsl(var(--border));
  --tw-prose-quotes: hsl(var(--text-secondary));
  --tw-prose-quote-borders: hsl(var(--accent));
  --tw-prose-captions: hsl(var(--text-tertiary));
  --tw-prose-kbd: hsl(var(--bg-muted));
  --tw-prose-kbd-shadows: hsl(var(--text-primary));
  --tw-prose-code: hsl(var(--accent));
  --tw-prose-pre-code: #e2e8f0;
  --tw-prose-pre-bg: #1A1625;
  --tw-prose-th-borders: hsl(var(--border));
  --tw-prose-td-borders: hsl(var(--border-subtle));
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: register typography plugin and customize prose colors

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Create MarkdownContent component

**Files:**
- Create: `src/components/task-hub/MarkdownContent.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/task-hub/MarkdownContent.tsx` with this content:

```tsx
'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useMemo, useState } from 'react';
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

function preprocessMentions(content: string): string {
  return content.replace(
    /(@\w+)/g,
    '<span class="inline-block px-1 bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))] rounded-[2px] font-bold mx-0.5">$1</span>'
  );
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const preprocessed = useMemo(() => preprocessMentions(content), [content]);

  return (
    <div className="markdown-body prose prose-sm prose-invert max-w-none text-[12px] leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-[14px] [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-[13px] [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-[12px] [&_h3]:mt-1.5 [&_h3]:mb-0.5 [&_blockquote]:my-1 [&_pre]:bg-[#1A1625] [&_pre]:rounded-[4px] [&_table]:text-[11px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code: CodeBlock as any,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-[hsl(var(--accent))] underline hover:brightness-125">
              {children}
            </a>
          ),
        }}
      >
        {preprocessed}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/task-hub/MarkdownContent.tsx
git commit -m "feat: create MarkdownContent component with syntax highlighting

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Wire MarkdownContent into ChatMessageItem

**Files:**
- Modify: `src/components/task-hub/ChatMessageItem.tsx`

- [ ] **Step 1: Add import**

At the top of `src/components/task-hub/ChatMessageItem.tsx`, add the import after the existing imports:

```tsx
import { MarkdownContent } from './MarkdownContent';
```

- [ ] **Step 2: Replace the content rendering block**

Find the block at lines 166-170 in `ChatMessageItem.tsx`:

```tsx
          {message.isStreaming && !message.content && !hasToolEvents ? (
            <span className="inline-block w-1.5 h-4 bg-current animate-pulse rounded-full opacity-50" />
          ) : message.content ? (
            <div className="whitespace-pre-wrap break-words">{formatContentWithMentions(message.content)}</div>
          ) : null}
```

Replace with:

```tsx
          {message.isStreaming && !message.content && !hasToolEvents ? (
            <span className="inline-block w-1.5 h-4 bg-current animate-pulse rounded-full opacity-50" />
          ) : message.content ? (
            isHuman ? (
              <div className="whitespace-pre-wrap break-words">{formatContentWithMentions(message.content)}</div>
            ) : (
              <MarkdownContent content={message.content} />
            )
          ) : null}
```

Key change: agent messages now use `<MarkdownContent>` instead of the plain text div. Human messages keep the existing `formatContentWithMentions` behavior.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/task-hub/ChatMessageItem.tsx
git commit -m "feat: render agent replies as markdown, keep human messages as plain text

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Dependencies installed → Task 1 ✓
- Typography plugin + prose colors → Task 2 ✓
- MarkdownContent with GFM + highlight + code blocks + @mentions → Task 3 ✓
- Agent/human branching in ChatMessageItem → Task 4 ✓

**Placeholder scan:** No TBD/TODO. All code blocks contain actual content.

**Type consistency:** `MarkdownContentProps.content` is `string`, matches `ChatMessage.content` type. `CodeBlock` component signature matches react-markdown's expected `code` component type.
