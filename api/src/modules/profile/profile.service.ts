import * as profileRepo from "@/modules/profile/profile.repository";
import * as libraryRepo from "@/modules/library/library.repository";
import { toResponse as mangaToResponse } from "@/modules/manga/manga.service";
import {
  Profile,
  UpdateProfileInput,
  ProfileResponse,
  PublicProfileResponse,
  ProfileStatsResponse,
  Badge,
  BadgeRarity,
} from "@/modules/profile/profile.model";
import { notFound } from "@/shared/http/error";
import { envSchema } from "@/env";
import { createConfig, isOwnerEmail } from "@/config";
import { UUID } from "@/shared/types/id";

const env = envSchema.parse(process.env);
const config = createConfig(env);

// How many titles the private "most read" stat returns.
const MOST_READ_LIMIT = 5;

function toResponse(profile: Profile, badges: Badge[]): ProfileResponse {
  return {
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    profileVisibility: profile.profileVisibility,
    shelfVisibility: profile.shelfVisibility,
    badges,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export async function getProfile(userId: UUID): Promise<ProfileResponse> {
  const profile = await profileRepo.findByUserId(userId);

  if (!profile) {
    throw notFound("Profile not found", {
      code: "PROFILE_NOT_FOUND",
    });
  }

  const badges = await computeBadges(profile.userId);
  return toResponse(profile, badges);
}

// Rarer badges sort first. `limited` badges are config-gated (e.g. the superuser
// role); `common` are broadly earnable.
const RARITY_RANK: Record<BadgeRarity, number> = {
  limited: 3,
  rare: 2,
  common: 1,
};

// Derived achievements, recomputed per request from existing data:
// - `owner` (limited): the instance owner — the DEFAULT_SUPERUSER_EMAIL
//   account. Replaces the admin badge for that account (no double badge); the
//   limited/icy tier is exclusive to it.
// - `admin` (rare): any other user holding the superuser role, which is only
//   granted via API config (SUPERUSER_EMAILS). Deliberately presented as
//   "Admin" — the public payload never says "superuser".
// - `uploader` (common): the user has published at least one readable chapter.
// Returned sorted by rarity (rarest first) so a user with many badges leads with
// the most exclusive one.
async function computeBadges(userId: UUID): Promise<Badge[]> {
  const [{ role, email }, isUploader] = await Promise.all([
    profileRepo.getUserAuthInfo(userId),
    profileRepo.hasCompletedImport(userId),
  ]);

  const badges: Badge[] = [];
  if (isOwnerEmail(config, email)) {
    badges.push({ code: "owner", label: "Owner", rarity: "limited" });
  } else if (role === "superuser") {
    badges.push({ code: "admin", label: "Admin", rarity: "rare" });
  }
  if (isUploader) {
    badges.push({ code: "uploader", label: "Uploader", rarity: "common" });
  }

  return badges.sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity]);
}

// Public username lookup. Visibility is enforced here, server-side, not in the
// UI: a private profile is reported as not found (indistinguishable from a
// missing user, so it does not enable enumeration). The favorites shelf is only
// populated when shelf_visibility is public; reading stats are never exposed.
export async function getPublicProfileByUsername(
  username: string
): Promise<PublicProfileResponse> {
  const profile = await profileRepo.findByUsername(username);

  if (!profile || profile.profileVisibility === "private") {
    throw notFound("Profile not found", {
      code: "PROFILE_NOT_FOUND",
    });
  }

  const shelfVisible = profile.shelfVisibility === "public";
  const [badges, favorites] = await Promise.all([
    computeBadges(profile.userId),
    shelfVisible
      ? libraryRepo
          .listEntries(profile.userId, "favorite")
          .then((entries) => entries.map((entry) => entry.manga))
      : Promise.resolve([]),
  ]);

  return {
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    createdAt: profile.createdAt.toISOString(),
    badges,
    shelf: { visible: shelfVisible, favorites },
  };
}

// Private reading stats for the signed-in user only. Never returned from the
// public lookup.
export async function getProfileStats(
  userId: UUID
): Promise<ProfileStatsResponse> {
  const [titlesRead, chaptersRead, pagesRead, mostRead] = await Promise.all([
    profileRepo.countReadTitles(userId),
    profileRepo.countReadChapters(userId),
    profileRepo.countReadPages(userId),
    profileRepo.findMostReadManga(userId, MOST_READ_LIMIT),
  ]);

  return {
    titlesRead,
    chaptersRead,
    pagesRead,
    mostReadManga: mostRead.map((entry) => ({
      manga: mangaToResponse(entry.manga),
      readChapters: entry.readChapters,
    })),
  };
}

export async function updateProfile(userId: UUID, input: UpdateProfileInput): Promise<ProfileResponse> {
  const existingProfile = await profileRepo.findByUserId(userId);
  if (!existingProfile) {
    throw notFound("Profile not found", {
      code: "PROFILE_NOT_FOUND",
    });
  }

  // Username is assigned once at registration and is immutable: ignore any
  // attempt to change it so only displayName/visibility can be updated.
  const { username: _ignoredUsername, ...mutableInput } = input;

  const profile = await profileRepo.update(userId, mutableInput);
  if (!profile) {
    throw notFound("Profile not found", {
      code: "PROFILE_NOT_FOUND",
    });
  }

  const badges = await computeBadges(profile.userId);
  return toResponse(profile, badges);
}
