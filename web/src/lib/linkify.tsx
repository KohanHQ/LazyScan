import type { ReactNode } from "react";

// Capture group so split() keeps the matches: even indexes are plain text,
// odd indexes are URLs.
const URL_PATTERN = /(https?:\/\/[^\s]+)/;
// ponytail: unconditional trim, so a URL ending in real punctuation (a
// Wikipedia "…_(bar)" path) loses it; upgrade = balance-aware paren matching.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

// Renders user-authored text with bare http(s) URLs as links. Split-based, so
// the text stays React-escaped — never dangerouslySetInnerHTML.
export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  text.split(URL_PATTERN).forEach((part, index) => {
    if (part === "") {
      return;
    }
    if (index % 2 === 0) {
      nodes.push(part);
      return;
    }
    const trailing = TRAILING_PUNCTUATION.exec(part)?.[0] ?? "";
    const href = trailing === "" ? part : part.slice(0, -trailing.length);
    // Nothing left after the scheme (e.g. "https://.") — not a link.
    if (!/^https?:\/\/\S/.test(href)) {
      nodes.push(part);
      return;
    }
    nodes.push(
      <a
        key={index}
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
      >
        {href}
      </a>
    );
    if (trailing !== "") {
      nodes.push(trailing);
    }
  });
  return nodes;
}
