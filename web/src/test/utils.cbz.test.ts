import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import {
  MAX_ARCHIVE_BYTES,
  extractCbz,
  isArchiveFile,
  isImageEntry,
  normalizeEntryName,
} from "@/utils/cbz";

function bytes(n = 8): Uint8Array<ArrayBuffer> {
  return new Uint8Array(n).fill(1);
}

function archive(entries: Record<string, Uint8Array>, name = "chapter.cbz"): File {
  return new File([zipSync(entries)], name, { type: "application/zip" });
}

describe("isArchiveFile", () => {
  test.each([
    ["chapter.cbz", true],
    ["chapter.zip", true],
    ["CHAPTER.CBZ", true],
    ["001.png", false],
    ["cover.webp", false],
  ])("%s -> %p", (filename, expected) => {
    expect(isArchiveFile(new File([], filename))).toBe(expected);
  });
});

describe("isImageEntry", () => {
  test.each([
    ["001.jpg", true],
    ["pages/002.png", true],
    ["003.WEBP", true],
    ["dir/", false],
    ["__MACOSX/._001.jpg", false],
    ["sub/__MACOSX/x.jpg", false],
    [".hidden.png", false],
    ["ComicInfo.xml", false],
    ["cover.txt", false],
  ])("%s -> %p", (path, expected) => {
    expect(isImageEntry(path)).toBe(expected);
  });
});

describe("normalizeEntryName", () => {
  test("strips leading ./", () => {
    expect(normalizeEntryName("./001.jpg")).toBe("001.jpg");
  });
  test("keeps inner directories", () => {
    expect(normalizeEntryName("vol01/001.jpg")).toBe("vol01/001.jpg");
  });
});

describe("extractCbz", () => {
  test("returns only image pages with correct names and MIME", async () => {
    const file = archive({
      "001.jpg": bytes(),
      "002.png": bytes(),
      "003.webp": bytes(),
      "ComicInfo.xml": bytes(),
      "__MACOSX/._001.jpg": bytes(),
    });

    const pages = await extractCbz(file);
    const byName = new Map(pages.map((p) => [p.name, p]));

    expect(pages).toHaveLength(3);
    expect([...byName.keys()].sort()).toEqual(["001.jpg", "002.png", "003.webp"]);
    expect(byName.get("001.jpg")?.type).toBe("image/jpeg");
    expect(byName.get("002.png")?.type).toBe("image/png");
    expect(byName.get("003.webp")?.type).toBe("image/webp");
  });

  test("preserves nested directory paths in the filename", async () => {
    const file = archive({ "vol01/001.jpg": bytes(), "vol01/002.jpg": bytes() });
    const pages = await extractCbz(file);
    expect(pages.map((p) => p.name).sort()).toEqual(["vol01/001.jpg", "vol01/002.jpg"]);
  });

  test("throws when the archive has no image pages", async () => {
    const file = archive({ "ComicInfo.xml": bytes(), "readme.txt": bytes() });
    await expect(extractCbz(file)).rejects.toThrow("No image pages");
  });

  test("throws on a corrupt / non-zip file", async () => {
    const file = new File([bytes(32)], "broken.cbz", { type: "application/zip" });
    await expect(extractCbz(file)).rejects.toThrow("valid CBZ/ZIP");
  });

  test("throws when the archive exceeds the size cap", async () => {
    const file = archive({ "001.jpg": bytes() });
    Object.defineProperty(file, "size", { value: MAX_ARCHIVE_BYTES + 1 });
    await expect(extractCbz(file)).rejects.toThrow("too large");
  });
});
