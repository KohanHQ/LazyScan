// Client-side CBZ/ZIP extraction: unzip a comic archive in the browser into
// image File objects that feed the existing page upload flow unchanged.

import { unzip } from "fflate";

// Hard cap before unzip — the archive is held in memory, so this is the real OOM
// guard (the desktop gate below is only UX).
export const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024; // 250 MB

const ARCHIVE_EXTENSIONS = [".cbz", ".zip"];
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

// Detect a comic archive by extension (dropped files / zip entries carry no MIME).
export function isArchiveFile(file: File): boolean {
  return hasExtension(file.name, ARCHIVE_EXTENSIONS);
}

// Gate CBZ to desktop: unzipping holds the archive in memory (a phone can OOM).
// Callers must guard at selection time too — drag-drop bypasses <input accept>.
export function cbzSupported(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return (
    window.matchMedia("(pointer: fine)").matches &&
    window.matchMedia("(min-width: 1024px)").matches
  );
}

// Unzip into image File objects. Throws on oversize / corrupt / image-less
// archives. Decompression is off-thread; non-images are filtered before inflate.
export async function extractCbz(file: File): Promise<File[]> {
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new Error(
      `Archive is too large (${formatMb(file.size)}). Maximum is ${formatMb(MAX_ARCHIVE_BYTES)}.`
    );
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const unzipped = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(buffer, { filter: (entry) => isImageEntry(entry.name) }, (err, data) => {
      if (err) {
        reject(new Error("Could not read the archive. Is it a valid CBZ/ZIP file?"));
        return;
      }
      resolve(data);
    });
  });

  const files: File[] = [];
  for (const [path, bytes] of Object.entries(unzipped)) {
    const type = mimeFromExtension(path);
    if (!type) {
      continue; // defensive — filter already excluded non-images
    }
    // Re-wrap so the part is a fresh ArrayBuffer-backed view (BlobPart-compatible).
    files.push(new File([new Uint8Array(bytes)], normalizeEntryName(path), { type }));
  }

  if (files.length === 0) {
    throw new Error("No image pages found in the archive.");
  }

  return files;
}

// True for real page images; drops directories, `__MACOSX/`, dotfiles, non-images.
export function isImageEntry(path: string): boolean {
  if (path.endsWith("/")) {
    return false;
  }
  if (path === "__MACOSX" || path.startsWith("__MACOSX/") || path.includes("/__MACOSX/")) {
    return false;
  }
  const base = baseName(path);
  if (base === "" || base.startsWith(".")) {
    return false;
  }
  return hasExtension(base, IMAGE_EXTENSIONS);
}

// Drop a leading "./" but keep inner dirs so the server's numeric sort orders
// nested archives correctly; flat archives reduce to the bare filename.
export function normalizeEntryName(path: string): string {
  return path.replace(/^\.\//, "");
}

function mimeFromExtension(name: string): string | null {
  switch (extensionOf(name)) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return null;
  }
}

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function hasExtension(name: string, extensions: string[]): boolean {
  const lower = name.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}
