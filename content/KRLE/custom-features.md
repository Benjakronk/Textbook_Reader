---
title: Custom Markdown Features
tags: [guide, reference]
---

# Custom Markdown Features

This document describes the rendering extensions this app supports beyond standard CommonMark / GFM. Standard markdown (headings, lists, tables, fenced code, links, images, blockquotes, GFM task lists, strikethrough, etc.) all work as expected — only the *non-standard* features are documented here.

## Wiki links

Internal links to other markdown files use double brackets. Targets are matched case-insensitively against full paths first, then bare filenames.

```
[[welcome]]
[[notes/example]]
[[notes/example|a custom display label]]
```

Type `[[` in the editor to trigger filename autocomplete. Clicking a wiki link opens that file in the current pane; right-click for "Open in side pane".

## Embeds (transclusion)

Prefix a wiki link with `!` to inline another file's rendered content where the link sits.

```
![[notes/example]]
![[notes/example|Optional header label]]
```

Embeds render as a card showing the target's path with the inlined document inside. Embeds inside an embedded document are rendered as plain wiki links to avoid recursion loops.

## Page breaks

For PDF / print export. A line containing only one of these markers becomes a hard page break:

```
\pagebreak
\page
<!-- pagebreak -->
```

In the editor preview these show as a dashed accent rule labeled "page break". The print stylesheet also keeps headings with their next paragraph and applies `orphans: 3; widows: 3` to paragraphs.

## Footnotes

Reference and definition syntax:

```
This claim needs support[^1] and so does this one[^src].

[^1]: First footnote text.
[^src]: A longer definition can span multiple words and supports **markdown** inline.
```

References render as superscript links; definitions are collected into a numbered list at the bottom of the document with backlinks (↩) to the reference. The toolbar's footnote button auto-numbers and appends a placeholder definition.

## Callouts (admonitions)

Blockquote-style callouts using `> [!type] Title` for the header, with body lines on subsequent quoted lines:

```
> [!note] Optional title
> Body text. Supports **markdown**.
> Multiple lines too.
```

Recognized types and their accent colors:

| Type        | Icon | Accent       |
| ----------- | ---- | ------------ |
| `note`      | 📝   | accent       |
| `info`      | ℹ️    | accent       |
| `tip`       | 💡   | success/good |
| `success`   | ✅   | success/good |
| `warning`   | ⚠️    | warn         |
| `danger`    | ⛔   | danger       |
| `question`  | ❓   | accent       |
| `quote`     | ❝   | muted        |
| `abstract`  | 📘   | accent       |
| `example`   | 🧪   | success/good |

Unknown types fall back to a generic 📌 with the default accent.

## Highlight, subscript, superscript

```
==highlighted text==
H~2~O      → H₂O styling via <sub>
E = mc^2^  → x² styling via <sup>
```

Be careful with single tildes: `~~strikethrough~~` (double) stays standard markdown. Single `~text~` becomes subscript. The `^` rule skips `[^id]` so it doesn't collide with footnotes.

## Math

KaTeX renders inline and block math.

```
Inline: $E = mc^2$
Block:
$$
\int_0^\infty e^{-x^2}\,dx = \tfrac{\sqrt{\pi}}{2}
$$
```

## Mermaid diagrams

Fenced code blocks tagged `mermaid` are rendered as SVG diagrams.

````
```mermaid
graph LR
  A[Start] --> B[Step]
  B --> C{Decision}
  C -->|yes| D[End]
  C -->|no|  B
```
````

## Tags

Hashtags inside body text and in YAML frontmatter `tags:` are extracted into the sidebar tag cloud. Body tags must start with a letter:

```
Tagged with #project and #wip-design.
```

## YAML frontmatter

Top-of-file metadata block:

```
---
title: My document
date: 2026-05-05
tags: [draft, design]
---
```

Frontmatter is stripped from the rendered view but indexed for tag and metadata lookup. The toolbar's frontmatter button inserts a starter block.

## Collapsible sections

Plain HTML `<details>` works and is styled:

```
<details>
  <summary>Click to expand</summary>

  Hidden content. Markdown does **not** parse inside HTML blocks, so use plain text or HTML here.
</details>
```

## Images with caption

Use `<figure>` for images that need a caption:

```
<figure>
  <img src="/md/_assets/screenshot.png" alt="Screenshot" />
  <figcaption>Application overview after first launch.</figcaption>
</figure>
```

## HTML comments

`<!-- like this -->` are not rendered but stay in the source — useful for editorial notes.

## Rendering pipeline order

For reference, transforms run in this order before `marked` parses the result:

1. Strip frontmatter
2. Footnotes (definitions removed, references replaced, list appended)
3. Page breaks → `<hr class="pagebreak">`
4. Subscript / superscript
5. Highlight `==…==`
6. Callouts → `<div class="callout …">`
7. Embeds → placeholder `<div class="embed">`, hydrated asynchronously after parse
8. Wiki links `[[…]]` → resolved or `wiki-broken:` links

If a transform's syntax appears inside a fenced code block, it's left alone (transforms operate on the source after frontmatter stripping but `marked` still treats fenced blocks as literal code).