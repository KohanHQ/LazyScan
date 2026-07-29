import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { linkify } from "@/lib/linkify";

// The nodes are either plain strings or <a> elements; these read back the
// shape without needing a DOM renderer.
function hrefs(nodes: ReactNode[]): string[] {
  return nodes
    .filter((node) => isValidElement<{ href: string }>(node))
    .map((node) => node.props.href);
}

function text(nodes: ReactNode[]): string {
  return nodes
    .map((node) =>
      isValidElement<{ children: string }>(node) ? node.props.children : node,
    )
    .join("");
}

describe("linkify", () => {
  test("returns the text untouched when there is no url", () => {
    const nodes = linkify("just a plain comment, nothing to click");
    expect(hrefs(nodes)).toEqual([]);
    expect(nodes).toEqual(["just a plain comment, nothing to click"]);
  });

  test("links a url at the start, middle and end", () => {
    expect(hrefs(linkify("https://example.com/a is worth a look"))).toEqual([
      "https://example.com/a",
    ]);
    expect(hrefs(linkify("see https://example.com/b for details"))).toEqual([
      "https://example.com/b",
    ]);
    expect(hrefs(linkify("details at http://example.com/c"))).toEqual([
      "http://example.com/c",
    ]);
  });

  test("keeps trailing sentence punctuation out of the href", () => {
    const nodes = linkify("read https://example.com/page.");
    expect(hrefs(nodes)).toEqual(["https://example.com/page"]);
    expect(text(nodes)).toBe("read https://example.com/page.");
  });

  test("trims a closing paren but keeps a path segment intact", () => {
    expect(hrefs(linkify("(https://example.com/x)"))).toEqual([
      "https://example.com/x",
    ]);
    expect(hrefs(linkify("https://example.com/wiki/Foo_(bar)"))).toEqual([
      "https://example.com/wiki/Foo_(bar",
    ]);
  });

  test("finds every url in the string", () => {
    expect(
      hrefs(linkify("https://a.example one https://b.example two")),
    ).toEqual(["https://a.example", "https://b.example"]);
  });

  test("leaves a scheme with no host as plain text", () => {
    const nodes = linkify("https://.");
    expect(hrefs(nodes)).toEqual([]);
    expect(text(nodes)).toBe("https://.");
  });
});
