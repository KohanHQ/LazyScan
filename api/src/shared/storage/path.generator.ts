import { UUID } from "@/shared/types/id";

export interface MangaPathOptions {
  mangaSlug: string;
  type: "cover" | "chapter";
  filename: string;
  chapterOrder?: number;
}

export interface GenericPathOptions {
  userId: UUID;
  type: string;
  filename: string;
}

export function generateMangaPath(options: MangaPathOptions): string {
  const { mangaSlug, type, filename, chapterOrder } = options;
  
  const sanitizedSlug = mangaSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const sanitizedFilename = filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .substring(0, 50);
  
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const extension = sanitizedFilename.split('.').pop() || 'webp';
  
  if (type === "cover") {
    return `manga/${sanitizedSlug}/cover/${timestamp}_${random}.${extension}`;
  }
  
  if (type === "chapter" && chapterOrder !== undefined) {
    // Pad chapter order with zeros (e.g., 001, 002, etc.)
    const paddedOrder = chapterOrder.toString().padStart(3, '0');
    return `manga/${sanitizedSlug}/chapter/${paddedOrder}/${timestamp}_${random}.${extension}`;
  }
  
  throw new Error(`Invalid manga path options: ${JSON.stringify(options)}`);
}

/**
 * Generate generic storage paths for non-manga files
 */
export function generateGenericPath(options: GenericPathOptions): string {
  const { userId, type, filename } = options;
  
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 50);
  
  return `uploads/${type}/${userId}/${timestamp}_${random}_${sanitized}`;
}

export function extractMangaSlugFromPath(path: string): string | null {
  const match = path.match(/^manga\/([^\/]+)\//);
  return match ? match[1] : null;
}

export function isMangaPath(path: string): boolean {
  return path.startsWith('manga/');
}