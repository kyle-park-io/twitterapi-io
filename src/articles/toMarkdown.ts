/*
  Turns an X long-form article into Markdown.

  X stores an article body as a Draft.js block list: a flat array of blocks,
  each with a type, its text, and style ranges given as offsets into that
  text. There is no nesting and no entity map in what the API returns, so the
  conversion is a straight walk over the blocks.
*/

export interface InlineStyleRange {
  offset: number;
  length: number;
  style: string;
}

export interface ArticleBlock {
  type: string;
  text?: string;
  inlineStyleRanges?: InlineStyleRange[];
  /** Present on `image` blocks. */
  url?: string;
  width?: number;
  height?: number;
}

export interface ArticleImage {
  url: string;
  /** File name the image is written as, relative to the post directory. */
  fileName: string;
}

export interface MarkdownArticle {
  markdown: string;
  images: ArticleImage[];
}

const MARKER: Record<string, string> = {
  Bold: "**",
  Italic: "_",
};

const HTML_TAG: Record<string, string> = {
  Bold: "strong",
  Italic: "em",
};

/**
 * Escapes the characters Markdown would otherwise read as syntax.
 *
 * The block text is plain prose, so every active character in it is a
 * hazard. The one that actually bit: an article wrote a range as "40~65%",
 * and GFM read `~...~` as strikethrough and rendered "40<del>65%</del>".
 */
export function escapeInline(text: string): string {
  // Anything the author wrote as real Markdown, or as a bare URL, is left
  // exactly as it is. They do write links by hand - one article's "Learn
  // More" section is a list of them - and escaping the brackets turned each
  // into literal text followed by a naked URL in parentheses. A URL is
  // spared too: escaping an underscore inside one breaks the link.
  const KEEP =
    /(\[[^\]\n]*\]\([^)\s]+(?:\s+"[^"]*")?\)|<?https?:\/\/[^\s<>)\]]+>?)/g;

  return text
    .split(KEEP)
    .map((piece, index) =>
      // split() with one capture group alternates: gap, match, gap, match...
      index % 2 === 1 ? piece : piece.replace(/([\\`*_~[\]<>])/g, "\\$1"),
    )
    .join("");
}

/**
 * Drops emphasis markers the author typed inside a range they also styled.
 *
 * One article has `**fully on-chain orderbook**` as the text of a bold range:
 * a Markdown habit carried into a WYSIWYG editor. Escaped faithfully, it
 * renders as bold text with literal asterisks around it, which reads as a
 * mistake rather than as emphasis.
 */
export function stripRedundantMarkers(text: string): string {
  let out = text;
  for (const marker of ["**", "__", "*", "_"]) {
    while (
      out.length > marker.length * 2 &&
      out.startsWith(marker) &&
      out.endsWith(marker)
    ) {
      out = out.slice(marker.length, -marker.length).trim();
    }
  }
  return out;
}

/** True where a `**` next to this character would still parse as emphasis. */
function isBoundary(char: string | undefined): boolean {
  // Start or end of the line, whitespace, or punctuation. CommonMark's
  // flanking rules let a delimiter open or close against any of these.
  if (char === undefined) return true;
  if (/\s/.test(char)) return true;
  return /[\p{P}\p{S}]/u.test(char);
}

/**
 * Applies inline styles to one block's text.
 *
 * Draft.js offsets count UTF-16 code units, which is what JavaScript string
 * indexing uses too, so the two agree - including for an emoji outside the
 * BMP, which is two units in both. Ranges are applied from the end backwards
 * so an earlier insertion cannot shift a later offset.
 *
 * A range surrounded by word characters gets HTML tags rather than `**`.
 * CommonMark will not open or close emphasis against a letter on both sides,
 * and Korean runs words straight into their particles - "**14.5%**입니다"
 * closes against the letter 입 and renders the asterisks literally. Eighteen
 * of them reached a built page that way.
 */
export function applyInlineStyles(
  text: string,
  ranges: InlineStyleRange[] | undefined,
): string {
  const usable = (ranges ?? [])
    .filter((r) => MARKER[r.style] !== undefined && r.length > 0)
    .filter((r) => r.offset >= 0 && r.offset + r.length <= text.length)
    .sort((a, b) => b.offset - a.offset);

  let out = escapeInline(text);
  if (usable.length === 0) return out;

  // Re-derive against the original text, then rebuild from its pieces, so
  // escaping never shifts an offset.
  out = "";
  let cursor = text.length;
  const pieces: string[] = [];

  for (const range of usable) {
    const end = range.offset + range.length;
    pieces.unshift(escapeInline(text.slice(end, cursor)));

    const styled = text.slice(range.offset, end);
    // A range that includes its own trailing space would put the closing
    // marker after it, and "** " closes nothing.
    // The spill is measured against the untouched slice: stripping the
    // author's own markers shortens the text, and slicing by the
    // shortened length left the markers behind as trailing prose.
    const withoutTrailingSpace = styled.trimEnd();
    const spill = styled.slice(withoutTrailingSpace.length);
    const trimmed = stripRedundantMarkers(withoutTrailingSpace);

    if (trimmed === "") {
      pieces.unshift(escapeInline(styled));
    } else {
      const before = range.offset > 0 ? text[range.offset - 1] : undefined;
      const after = spill !== "" ? " " : text[end];
      const body = escapeInline(trimmed);

      if (isBoundary(before) && isBoundary(after)) {
        const marker = MARKER[range.style];
        pieces.unshift(`${marker}${body}${marker}${escapeInline(spill)}`);
      } else {
        const tag = HTML_TAG[range.style];
        pieces.unshift(`<${tag}>${body}</${tag}>${escapeInline(spill)}`);
      }
    }
    cursor = range.offset;
  }
  pieces.unshift(escapeInline(text.slice(0, cursor)));

  return pieces.join("");
}

/** A file name for an image, from its URL and its position in the article. */
export function imageFileName(url: string, index: number): string {
  const base = url.split("?")[0];
  const dot = base.lastIndexOf(".");
  const ext = dot > base.lastIndexOf("/") ? base.slice(dot + 1) : "jpg";
  const safeExt = /^[a-z0-9]{2,5}$/i.test(ext) ? ext.toLowerCase() : "jpg";
  return `image-${String(index + 1).padStart(2, "0")}.${safeExt}`;
}

/**
 * Converts an article body to Markdown, collecting the images it references
 * so the caller can download them next to the post.
 *
 * `header-one` becomes `##`, not `#`: the post's own title is the page's h1,
 * and the blog's frontmatter check rejects a body that opens a second one.
 */
export function articleToMarkdown(blocks: ArticleBlock[]): MarkdownArticle {
  const lines: string[] = [];
  const images: ArticleImage[] = [];

  const LIST_TYPES = new Set(["unordered-list-item", "ordered-list-item"]);
  let inList = false;

  const HEADINGS = new Set(["header-one", "header-two", "header-three"]);

  // Some articles write their headings by hand, as a bold paragraph whose
  // text begins with `#` - X's editor has no heading button in every
  // surface. Left as paragraphs they render as literal hashes and the post
  // gets no structure at all: no headings, and so no table of contents. One
  // article's twelve sections all arrived this way.
  const HAND_WRITTEN_HEADING = /^(#{1,6})\s+(.+?)\s*$/;

  for (const block of blocks) {
    const handWritten =
      block.type === "unstyled"
        ? HAND_WRITTEN_HEADING.exec(block.text ?? "")
        : null;
    if (handWritten) {
      // Shifted down one level, for the same reason header-one is: the
      // post's title is the page's only h1.
      const depth = Math.min(handWritten[1].length + 1, 6);
      lines.push(`${"#".repeat(depth)} ${handWritten[2]}`, "");
      inList = false;
      continue;
    }

    // Inline styles are dropped inside a heading: a heading is already
    // emphatic, and the article's own `**Abstract**` came through as a
    // heading containing literal asterisks.
    const text = HEADINGS.has(block.type)
      ? (block.text ?? "").trim()
      : applyInlineStyles(block.text ?? "", block.inlineStyleRanges);

    // A list runs as consecutive lines, so whatever follows it needs a blank
    // line of its own: Markdown otherwise reads the next block as a lazy
    // continuation of the last item and swallows it into the list.
    if (inList && !LIST_TYPES.has(block.type)) {
      lines.push("");
    }
    inList = LIST_TYPES.has(block.type);

    switch (block.type) {
      case "header-one":
        lines.push(`## ${text}`, "");
        break;
      case "header-two":
        lines.push(`## ${text}`, "");
        break;
      case "header-three":
        lines.push(`### ${text}`, "");
        break;
      case "unordered-list-item":
        lines.push(`- ${text}`);
        break;
      case "ordered-list-item":
        lines.push(`1. ${text}`);
        break;
      case "blockquote":
        lines.push(`> ${text}`, "");
        break;
      case "divider":
        lines.push("---", "");
        break;
      case "markdown":
        // Already Markdown - fenced code, tables - so it passes through
        // untouched. Styling it would corrupt code.
        lines.push(block.text ?? "", "");
        break;
      case "image": {
        if (!block.url) break;
        const fileName = imageFileName(block.url, images.length);
        images.push({ url: block.url, fileName });
        lines.push(`![](./${fileName})`, "");
        break;
      }
      case "unstyled":
      default:
        if (text.trim() === "") break;
        lines.push(text, "");
        break;
    }
  }

  // A list runs as consecutive lines; every other block leaves a blank line
  // after it. Collapse runs of blank lines and trim the ends.
  const markdown = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { markdown: `${markdown}\n`, images };
}
