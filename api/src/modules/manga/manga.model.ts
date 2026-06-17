import { UUID } from "@/shared/types/id";

export type MangaStatus = "ongoing" | "completed" | "hiatus" | "cancelled";

export type MangaSort = "created_at" | "updated_at" | "title" | "published_year";

export type MangaOrder = "asc" | "desc";

export interface ListMangaOptions {
  limit?: number;
  offset?: number;
  search?: string;
  status?: MangaStatus;
  publishedYear?: number;
  // Single-tag containment filter (normalized lowercase, AND-combined with the
  // other filters like status/publishedYear).
  tag?: string;
  sort?: MangaSort;
  order?: MangaOrder;
  // Advanced search filters
  author?: string;
  artist?: string;
  publisher?: string;
  yearFrom?: number;
  yearTo?: number;
}

export interface Manga {
  id: UUID;
  title: string;
  slug: string;
  coverUrl: string | null;
  description: string | null;
  status: MangaStatus;
  totalChapters: number | null;
  author: string | null;
  artist: string | null;
  publisher: string | null;
  publishedYear: number | null;
  // Normalized lowercase tags; empty array when uncategorized (column is NOT
  // NULL DEFAULT '{}').
  tags: string[];
  createdByUserId: UUID | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMangaInput {
  title: string;
  slug: string;
  coverUrl?: string;
  description?: string;
  status?: MangaStatus;
  totalChapters?: number;
  author?: string;
  artist?: string;
  publisher?: string;
  publishedYear?: number;
  tags?: string[];
  createdByUserId?: UUID;
}

// Update semantics: a field left `undefined` is unchanged; an explicit `null`
// clears it to SQL NULL. `title`/`slug`/`status` are NOT NULL and stay required
// when present. `coverUrl` is managed through the dedicated cover route.
export interface UpdateMangaInput {
  title?: string;
  slug?: string;
  coverUrl?: string;
  description?: string | null;
  status?: MangaStatus;
  totalChapters?: number | null;
  author?: string | null;
  artist?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  // `null` clears to the empty array (the column is NOT NULL).
  tags?: string[] | null;
}

export interface MangaResponse {
  id: string;
  title: string;
  slug: string;
  coverUrl: string | null;
  description: string | null;
  status: MangaStatus;
  totalChapters: number | null;
  author: string | null;
  artist: string | null;
  publisher: string | null;
  publishedYear: number | null;
  tags: string[];
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
