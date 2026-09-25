// Msteams plugin module renders safe HTML for Graph-native Teams messages.

const TABLE_DELIMITER_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u;
const URL_RE = /^https?:\/\//iu;

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function safeHref(value: string): string | undefined {
  const trimmed = value.trim();
  if (!URL_RE.test(trimmed)) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
    return escapeHtml(parsed.href);
  } catch {
    return undefined;
  }
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableDelimiter(line: string): boolean {
  return TABLE_DELIMITER_RE.test(line);
}

function renderInlineMarkdownToHtml(markdown: string): string {
  const codeSpans: string[] = [];
  const codeProtected = markdown.replace(/`([^`\n]+)`/gu, (_match, code: string) => {
    const index = codeSpans.push(`<code>${escapeHtml(code)}</code>`) - 1;
    return `\uE000code-${index}\uE001`;
  });
  let html = escapeHtml(codeProtected);

  html = html.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/giu,
    (match, label: string, href: string) => {
      const safe = safeHref(href);
      return safe ? `<a href="${safe}">${label}</a>` : match;
    },
  );
  html = html.replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/gu, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n][^*\n]*?[^*\n])\*(?!\*)/gu, "$1<em>$2</em>");

  return html.replace(
    /\uE000code-(\d+)\uE001/gu,
    (_match, index: string) => codeSpans[Number(index)] ?? "",
  );
}

function renderParagraph(lines: readonly string[]): string {
  const content = lines.map((line) => renderInlineMarkdownToHtml(line)).join("<br>");
  return content ? `<p>${content}</p>` : "";
}

function renderTable(lines: readonly string[]): string {
  const header = splitTableCells(lines[0] ?? "");
  const rows = lines
    .slice(2)
    .map(splitTableCells)
    .filter((row) => row.some(Boolean));
  const thead = `<thead><tr>${header.map((cell) => `<th>${renderInlineMarkdownToHtml(cell)}</th>`).join("")}</tr></thead>`;
  const tbody = rows.length
    ? `<tbody>${rows
        .map(
          (row) =>
            `<tr>${header.map((_cell, index) => `<td>${renderInlineMarkdownToHtml(row[index] ?? "")}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody>`
    : "";
  return `<table>${thead}${tbody}</table>`;
}

function collectTable(
  lines: readonly string[],
  start: number,
): { end: number; html: string } | undefined {
  if (!lines[start]?.includes("|") || !isTableDelimiter(lines[start + 1] ?? "")) {
    return undefined;
  }
  let end = start + 2;
  while (end < lines.length && lines[end]?.includes("|") && lines[end]?.trim()) {
    end += 1;
  }
  return { end, html: renderTable(lines.slice(start, end)) };
}

function collectFence(
  lines: readonly string[],
  start: number,
): { end: number; html: string } | undefined {
  const opener = /^\s*(`{3,}|~{3,})/u.exec(lines[start] ?? "");
  if (!opener) {
    return undefined;
  }
  const marker = opener[1]?.[0] ?? "`";
  let end = start + 1;
  while (end < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`, "u").test(lines[end] ?? "")) {
    end += 1;
  }
  const contentEnd = Math.min(end, lines.length);
  const html = `<pre><code>${escapeHtml(lines.slice(start + 1, contentEnd).join("\n"))}</code></pre>`;
  return { end: end < lines.length ? end + 1 : contentEnd, html };
}

/**
 * Render agent Markdown into a deliberately small HTML subset accepted by Microsoft Graph
 * chatMessage bodies. All source text is escaped before Markdown markers become tags.
 */
export function renderGraphNativeMessageHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/gu, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(renderParagraph(paragraph));
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }

    const fence = collectFence(lines, index);
    if (fence) {
      flushParagraph();
      blocks.push(fence.html);
      index = fence.end;
      continue;
    }

    const table = collectTable(lines, index);
    if (table) {
      flushParagraph();
      blocks.push(table.html);
      index = table.end;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      flushParagraph();
      const level = Math.min(3, heading[1]?.length ?? 1);
      blocks.push(`<h${level}>${renderInlineMarkdownToHtml(heading[2] ?? "")}</h${level}>`);
      index += 1;
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.+)$/u.exec(line);
    if (bullet) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length) {
        const match = /^\s*[-*+]\s+(.+)$/u.exec(lines[index] ?? "");
        if (!match) {
          break;
        }
        items.push(`<li>${renderInlineMarkdownToHtml(match[1] ?? "")}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return blocks.filter(Boolean).join("");
}
