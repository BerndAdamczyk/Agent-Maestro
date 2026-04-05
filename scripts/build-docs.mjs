#!/usr/bin/env node

/**
 * Docs-as-code build pipeline for arc42 architecture documentation.
 *
 * Reads Markdown files from docs/, renders all ```mermaid blocks to inline SVGs
 * via @mermaid-js/mermaid-cli (mmdc), and produces a self-contained HTML file
 * in dist/.
 *
 * Usage:
 *   npm run build          — one-shot build
 *   npm run dev            — watch mode (rebuilds on file change)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, watch } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOCS_DIR = join(ROOT, "docs");
const DIST_DIR = join(ROOT, "dist");
const INPUT_FILE = join(DOCS_DIR, "arc42-architecture.md");

const MMDC = join(ROOT, "node_modules", ".bin", "mmdc");

// ── Mermaid rendering ──────────────────────────────────────────────

function renderMermaidBlock(code, index) {
  const tmp = join(tmpdir(), `mermaid-${process.pid}-${index}`);
  const inputFile = `${tmp}.mmd`;
  const outputFile = `${tmp}.svg`;

  writeFileSync(inputFile, code, "utf-8");

  try {
    execSync(
      `${MMDC} -i "${inputFile}" -o "${outputFile}" -b transparent --quiet`,
      { stdio: "pipe", timeout: 30000 }
    );
    const svg = readFileSync(outputFile, "utf-8");
    // Clean up temp files
    try {
      execSync(`rm -f "${inputFile}" "${outputFile}"`, { stdio: "ignore" });
    } catch {}
    return svg;
  } catch (err) {
    console.error(`  Warning: Failed to render diagram ${index + 1}: ${err.message}`);
    // Fallback: return the raw code in a <pre> block
    return `<pre class="mermaid-error"><code>${escapeHtml(code)}</code></pre>`;
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Markdown to HTML conversion ────────────────────────────────────

function markdownToHtml(md) {
  let html = md;

  // 1. Extract and render mermaid blocks first (before other processing)
  const mermaidBlocks = [];
  html = html.replace(/```mermaid\n([\s\S]*?)```/g, (_match, code) => {
    const index = mermaidBlocks.length;
    mermaidBlocks.push(code.trim());
    return `%%MERMAID_PLACEHOLDER_${index}%%`;
  });

  // 2. Render other fenced code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const langClass = lang ? ` class="language-${lang}"` : "";
    return `<pre><code${langClass}>${escapeHtml(code.trim())}</code></pre>`;
  });

  // 3. Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // 4. Tables
  html = html.replace(
    /^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm,
    (_match, header, _sep, body) => {
      const headers = header
        .split("|")
        .filter(Boolean)
        .map((h) => `<th>${h.trim()}</th>`)
        .join("");
      const rows = body
        .trim()
        .split("\n")
        .map((row) => {
          const cells = row
            .split("|")
            .filter(Boolean)
            .map((c) => `<td>${c.trim()}</td>`)
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("\n");
      return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    }
  );

  // 5. Headings
  html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.+)$/gm, '<h4 id="$1">$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, (_m, t) => `<h3 id="${slugify(t)}">${t}</h3>`);
  html = html.replace(/^##\s+(.+)$/gm, (_m, t) => `<h2 id="${slugify(t)}">${t}</h2>`);
  html = html.replace(/^#\s+(.+)$/gm, (_m, t) => `<h1 id="${slugify(t)}">${t}</h1>`);

  // 6. Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // 7. Unordered lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // 8. Blockquotes
  html = html.replace(/^>\s*(.+)$/gm, "<blockquote>$1</blockquote>");

  // 9. Horizontal rules
  html = html.replace(/^---$/gm, "<hr>");

  // 10. Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 11. Paragraphs (wrap remaining loose text)
  html = html.replace(/^(?!<[a-z/]|%%MERMAID)(.+)$/gm, "<p>$1</p>");

  // 12. Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");

  // 13. Now render mermaid diagrams and insert SVGs
  console.log(`  Rendering ${mermaidBlocks.length} Mermaid diagrams...`);
  for (let i = 0; i < mermaidBlocks.length; i++) {
    process.stdout.write(`    Diagram ${i + 1}/${mermaidBlocks.length}...`);
    const svg = renderMermaidBlock(mermaidBlocks[i], i);
    html = html.replace(
      `%%MERMAID_PLACEHOLDER_${i}%%`,
      `<div class="mermaid-diagram">${svg}</div>`
    );
    console.log(" done");
  }

  return html;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ── HTML template ──────────────────────────────────────────────────

function wrapInHtml(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root {
      --bg: #ffffff;
      --text: #1a1a2e;
      --heading: #16213e;
      --accent: #438DD5;
      --border: #e0e0e0;
      --code-bg: #f5f5f5;
      --table-stripe: #f9f9fb;
      --toc-bg: #f0f4f8;
      --blockquote-bg: #f0f4f8;
      --blockquote-border: #438DD5;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1a1a2e;
        --text: #e0e0e0;
        --heading: #a8d8ea;
        --accent: #6cb4ee;
        --border: #333355;
        --code-bg: #16213e;
        --table-stripe: #1e1e3a;
        --toc-bg: #16213e;
        --blockquote-bg: #16213e;
        --blockquote-border: #6cb4ee;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.7;
      color: var(--text);
      background: var(--bg);
      max-width: 960px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }
    h1, h2, h3, h4, h5, h6 {
      color: var(--heading);
      margin: 2rem 0 0.75rem;
      line-height: 1.3;
    }
    h1 { font-size: 2rem; border-bottom: 3px solid var(--accent); padding-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; margin-top: 3rem; }
    h3 { font-size: 1.25rem; }
    h4 { font-size: 1.1rem; }
    p { margin: 0.5rem 0; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
    code {
      background: var(--code-bg);
      padding: 0.15em 0.4em;
      border-radius: 3px;
      font-size: 0.9em;
      font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
    }
    pre {
      background: var(--code-bg);
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
      margin: 1rem 0;
      border: 1px solid var(--border);
    }
    pre code {
      background: none;
      padding: 0;
      font-size: 0.85em;
      line-height: 1.5;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
      font-size: 0.9em;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 0.5rem 0.75rem;
      text-align: left;
    }
    th { background: var(--accent); color: #fff; font-weight: 600; }
    tr:nth-child(even) { background: var(--table-stripe); }
    ul, ol { margin: 0.5rem 0 0.5rem 1.5rem; }
    li { margin: 0.25rem 0; }
    blockquote {
      background: var(--blockquote-bg);
      border-left: 4px solid var(--blockquote-border);
      padding: 0.75rem 1rem;
      margin: 1rem 0;
      border-radius: 0 6px 6px 0;
    }
    .mermaid-diagram {
      margin: 1.5rem 0;
      text-align: center;
      overflow-x: auto;
    }
    .mermaid-diagram svg {
      max-width: 100%;
      height: auto;
    }
    .mermaid-error {
      border: 2px dashed #e74c3c;
      background: #fdf0ef;
      color: #c0392b;
    }
    @media print {
      body { max-width: none; padding: 0; }
      .mermaid-diagram { page-break-inside: avoid; }
      h2 { page-break-before: always; }
      h2:first-of-type { page-break-before: avoid; }
    }
  </style>
</head>
<body>
${bodyHtml}
  <footer style="margin-top:3rem; padding-top:1rem; border-top:1px solid var(--border); font-size:0.8em; color:#888;">
    Generated on ${new Date().toISOString().slice(0, 10)} by agent-maestro docs pipeline
  </footer>
</body>
</html>`;
}

// ── Build ──────────────────────────────────────────────────────────

function build() {
  console.log("Building docs...");

  if (!existsSync(INPUT_FILE)) {
    console.error(`Error: ${INPUT_FILE} not found`);
    process.exit(1);
  }

  if (!existsSync(MMDC)) {
    console.error("Error: @mermaid-js/mermaid-cli not installed. Run: npm install");
    process.exit(1);
  }

  const md = readFileSync(INPUT_FILE, "utf-8");
  const bodyHtml = markdownToHtml(md);
  const html = wrapInHtml("Agent Orchestrator - Arc42 Architecture", bodyHtml);

  mkdirSync(DIST_DIR, { recursive: true });
  const outputPath = join(DIST_DIR, "arc42-architecture.html");
  writeFileSync(outputPath, html, "utf-8");

  console.log(`\n  Output: ${outputPath}`);
  console.log(`  Open: file://${outputPath}`);
}

// ── Watch mode ─────────────────────────────────────────────────────

if (process.argv.includes("--watch")) {
  build();
  console.log("\n  Watching for changes...\n");
  let debounce = null;
  watch(DOCS_DIR, { recursive: true }, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      console.log("\n  File changed, rebuilding...\n");
      build();
    }, 500);
  });
} else {
  build();
}
