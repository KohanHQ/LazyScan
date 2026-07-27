import { describe, expect, test } from "bun:test";
import { containsProfanity } from "@/shared/utility/profanity";
import {
  profileTransportSchemas,
  validateProfileRequest,
  ProfileValidator,
} from "@/modules/profile/profile.validation";
import { BusinessRuleError } from "@/shared/utility/validation";

describe("bio transport validation", () => {
  const update = profileTransportSchemas.update;

  test("accepts a bio at the 256-char ceiling", () => {
    const parsed = update.parse({ bio: "a".repeat(256) });
    expect(parsed.bio).toBe("a".repeat(256));
  });

  test("rejects a bio over 256 chars", () => {
    expect(() => update.parse({ bio: "a".repeat(257) })).toThrow();
  });

  test("maps empty string and null to null (clears the field)", () => {
    expect(update.parse({ bio: "" }).bio).toBeNull();
    expect(update.parse({ bio: null }).bio).toBeNull();
  });

  test("omitted bio stays undefined (left unchanged)", () => {
    expect(update.parse({ displayName: "x" }).bio).toBeUndefined();
  });
});

describe("profanity matcher", () => {
  test("flags leet/symbol/number swaps", () => {
    expect(containsProfanity("f0ck")).toBe(true);
    expect(containsProfanity("$hit")).toBe(true);
    expect(containsProfanity("sh!t")).toBe(true);
  });

  test("flags repeated-letter evasion and is case-insensitive", () => {
    expect(containsProfanity("fuuuck")).toBe(true);
    expect(containsProfanity("FUCK")).toBe(true);
  });

  test("does not flag substrings inside clean words", () => {
    expect(containsProfanity("a classic assignment")).toBe(false);
    expect(containsProfanity("Scunthorpe United")).toBe(false);
    expect(containsProfanity("an assassin in a grassy field")).toBe(false);
    // "ass" needs both s's: the common word "as" stays clean.
    expect(containsProfanity("clean as a whistle")).toBe(false);
  });

  test("spaced-out evasion slips through (accepted ceiling)", () => {
    expect(containsProfanity("f u c k")).toBe(false);
  });
});

describe("bio profanity guard", () => {
  const validate = (bio: string | null) =>
    validateProfileRequest(
      profileTransportSchemas.update,
      { bio },
      ProfileValidator.validateUpdate
    );

  test("accepts a clean bio", () => {
    expect(validate("reader, uploader, night owl").bio).toBe(
      "reader, uploader, night owl"
    );
  });

  test("rejects a profane bio with PROFILE_BIO_PROFANITY", () => {
    try {
      validate("send $h!t here");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessRuleError);
      expect((error as BusinessRuleError).rule).toBe("PROFILE_BIO_PROFANITY");
    }
  });

  test("a cleared bio (null) skips the guard", () => {
    expect(validate(null).bio).toBeNull();
  });
});
