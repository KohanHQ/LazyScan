import { apiRequest } from "@/api/client";
import type { Manga } from "@/api/manga";

export type ProfileVisibility = "public" | "private";

export type BadgeRarity = "common" | "rare" | "limited";

export type Badge = {
  code: string;
  label: string;
  rarity: BadgeRarity;
};

export type Profile = {
  username: string | null;
  displayName: string | null;
  // Null for everyone except the instance owner, whose owner-gated avatar
  // upload (POST /upload, type=avatar) sets it. Everyone else's avatar stays
  // derived from the display name.
  avatarUrl: string | null;
  profileVisibility: ProfileVisibility;
  shelfVisibility: ProfileVisibility;
  badges: Badge[];
  createdAt: string;
  updatedAt: string;
};

export type ProfileUpdate = {
  // username is immutable (assigned at registration; the API ignores changes)
  // and avatarUrl is not PATCHable (the API rejects it; the owner uses the
  // avatar upload instead), so neither is part of the patch shape.
  // null (or "") clears displayName; undefined leaves a field unchanged.
  displayName?: string | null;
  profileVisibility?: ProfileVisibility;
  shelfVisibility?: ProfileVisibility;
};

export type AvatarUploadResult = {
  upload: {
    id: string;
    status: "pending" | "processing" | "completed" | "failed";
    originalUrl: string | null;
    processedUrl: string | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  };
  avatarUrl: string;
};

// Public username lookup payload: identity + derived badges + the optional
// favorites shelf. No visibility flags, no reading stats.
export type PublicProfile = {
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  badges: Badge[];
  shelf: {
    visible: boolean;
    favorites: Manga[];
  };
};

export type MostReadManga = {
  manga: Manga;
  readChapters: number;
};

export type ProfileStats = {
  titlesRead: number;
  chaptersRead: number;
  pagesRead: number;
  mostReadManga: MostReadManga[];
};

export function getMyProfile(): Promise<Profile> {
  return apiRequest<Profile>("/profile/me");
}

export function getMyStats(): Promise<ProfileStats> {
  return apiRequest<ProfileStats>("/profile/me/stats");
}

export function updateMyProfile(patch: ProfileUpdate): Promise<Profile> {
  return apiRequest<Profile>("/profile/me", {
    method: "PATCH",
    body: patch,
  });
}

// Owner-only custom avatar (the API 403s everyone else). Goes through the
// generic upload route, which processes the image and sets profiles.avatar_url.
export function uploadAvatar(file: File): Promise<AvatarUploadResult> {
  const form = new FormData();
  form.set("file", file);
  form.set("type", "avatar");
  return apiRequest<AvatarUploadResult>("/upload", {
    method: "POST",
    body: form,
  });
}

export function getProfileByUsername(username: string): Promise<PublicProfile> {
  return apiRequest<PublicProfile>(
    `/profile/username/${encodeURIComponent(username)}`
  );
}
