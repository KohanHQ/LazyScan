import { UUID } from "@/shared/types/id";
import type { MangaResponse } from "@/modules/manga/manga.model";

// Two independent visibility flags govern what the public username lookup
// exposes (see migration 018_profile_visibility.sql). Stats are never public.
export type ProfileVisibility = "public" | "private";

export interface Profile {
  userId: UUID;
  username: string | null;
  displayName: string | null;
  // Optional free-text "about me" (migration 031). Capped at 256 chars and
  // profanity-guarded at the validation layer; stored raw.
  bio: string | null;
  avatarUrl: string | null;
  profileVisibility: ProfileVisibility;
  shelfVisibility: ProfileVisibility;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProfileInput {
  userId: UUID;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface UpdateProfileInput {
  username?: string;
  // null explicitly clears the field; undefined leaves it unchanged.
  displayName?: string | null;
  // Same null-clears / undefined-unchanged contract as displayName.
  bio?: string | null;
  // Visibility flags are a closed set; undefined leaves the stored value
  // unchanged. avatarUrl is intentionally not updatable: the avatar is derived
  // from the display name.
  profileVisibility?: ProfileVisibility;
  shelfVisibility?: ProfileVisibility;
}

// Derived achievement shown on profiles. Badges are computed per request from
// existing data, not stored. `rarity` drives display order (rarest first) and
// styling: `limited` badges are config-gated (e.g. the superuser role, which is
// only granted via API config), `common` are broadly earnable (e.g. uploader).
export type BadgeRarity = "common" | "rare" | "limited";

export interface Badge {
  code: string;
  label: string;
  rarity: BadgeRarity;
}

export interface ProfileResponse {
  username: string | null;
  displayName: string | null;
  bio: string | null;
  // Retained in the read shape for backward compatibility; always null because
  // the avatar is derived client-side and the write path no longer accepts it.
  avatarUrl: string | null;
  profileVisibility: ProfileVisibility;
  shelfVisibility: ProfileVisibility;
  // Owner sees their own badges on the profile view (same derivation as the
  // public lookup).
  badges: Badge[];
  createdAt: string;
  updatedAt: string;
}

// Public-profile payload: the readable identity fields plus derived badges and
// the optional favorites shelf. Excludes the owner's visibility flags and all
// reading stats. `shelf.visible` reflects shelf_visibility; `favorites` is empty
// when the shelf is private.
export interface PublicProfileResponse {
  username: string | null;
  displayName: string | null;
  // Public whenever profile_visibility is public; there is no bio-level flag.
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;
  badges: Badge[];
  shelf: {
    visible: boolean;
    favorites: MangaResponse[];
  };
}

export interface MostReadManga {
  manga: MangaResponse;
  readChapters: number;
}

// Private reading stats, only ever returned from the authenticated /me route.
export interface ProfileStatsResponse {
  titlesRead: number;
  chaptersRead: number;
  pagesRead: number;
  mostReadManga: MostReadManga[];
}
