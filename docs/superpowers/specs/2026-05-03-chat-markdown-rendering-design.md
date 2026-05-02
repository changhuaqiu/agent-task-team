# Chat Markdown Rendering Design

## Problem

Agent replies in the chat are rendered as plain text (`whitespace-pre-wrap` + `@mention` highlighting). Agents output structured content (code blocks, lists, tables) that is unreadable without markdown rendering.

## Decision

Use `react-markdown` + `remark-gfm` + `rehype-highlight` + `@tailwindcss/typography` to render agent replies as formatted Markdown. Human messages remain plain text.

## Scope

- Only agent messages (`agentId !== 'human'`) get markdown rendering
- Full GFM syntax: bold, italic, strikethrough, inline code, fenced code blocks with syntax highlighting, ordered/unordered/task lists, tables, blockquotes, links
- `@mention` tokens preserved as highlighted spans within markdown

## Dependencies

```
react-markdown
remark-gfm
rehype-highlight
highlight.js
@tailwindcss/typography
```

## Architecture

### New Component: `MarkdownContent.tsx`

Encapsulates ReactMarkdown with:

- `remarkGfm` plugin for GFM extensions
- `rehypeHighlight` plugin for code syntax highlighting
- Custom component renderers:
  - `code` (inline): styled span with background color
  - `pre > code` (block): dark panel with language label + copy button + syntax highlighting
  - `a`: themed links opening in new tab
  - `table`, `th`, `td`: themed borders matching project palette
  - `blockquote`: left border accent
- `prose prose-invert` wrapper with color overrides to match project HSL tokens

### Rendering Logic in `ChatMessageItem.tsx`

```
if (message.agentId !== 'human') {
  // Agent: markdown rendering
  <MarkdownContent content={preprocessedContent} />
} else {
  // Human: plain text with @mention highlighting
  <div className="whitespace-pre-wrap break-words">{formatContentWithMentions(content)}</div>
}
```

### @mention Handling

Before passing content to ReactMarkdown, replace `@agentId` patterns with a markdown-compatible inline HTML span:

```
@jean → `<span class="mention-highlight">@jean</span>`
```

ReactMarkdown renders inline HTML by default, so the styled span passes through. This avoids writing a custom remark plugin.

### Style Integration

In `globals.css`:
- Register `@tailwindcss/typography` plugin
- Override `prose` color variables to use project HSL tokens:
  ```css
  .prose {
    --tw-prose-body: hsl(var(--text-primary));
    --tw-prose-headings: hsl(var(--text-primary));
    --tw-prose-links: hsl(var(--accent));
    --tw-prose-code: hsl(var(--accent));
    --tw-prose-pre-bg: #1A1625;
    --tw-prose-pre-code: #e2e8f0;
  }
  ```

## Files Changed

| File | Change |
|------|--------|
| `package.json` | Add 5 dependencies |
| `src/app/globals.css` | Register typography plugin, customize prose colors |
| `src/components/task-hub/ChatMessageItem.tsx` | Branch: agent → MarkdownContent, human → plain text |
| `src/components/task-hub/MarkdownContent.tsx` | New: ReactMarkdown wrapper with custom renderers |

No store, routing, or daemon changes — purely presentation layer.

## Style Target

Agent replies read like rendered GitHub comments: formatted headings, colored code blocks, proper table borders, styled blockquotes. Seamless integration with the existing dark theme via HSL token overrides.
