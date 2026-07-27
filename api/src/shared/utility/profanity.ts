import assert from "node:assert";

// Canonical profanity root list, shared by every validation-layer guard:
// comments mask matches (comment.validation.ts), the profile bio rejects the
// whole value (profile.validation.ts). Keep it small and root-shaped — the
// matchers, not the list, carry the evasion resistance.
export const PROFANITY_ROOTS = [
  "arse",
  "arsehole",
  "ass",
  "asshole",
  "bastard",
  "bitch",
  "bollocks",
  "bullshit",
  "cock",
  "crap",
  "cunt",
  "dick",
  "douche",
  "fuck",
  "piss",
  "prick",
  "shit",
  "slut",
  "twat",
  "wanker",
];

// Leet/symbol lookalikes per letter. `0` sits under both `o` and `u` so
// f0ck-style swaps resolve to the intended root, not the literal "fock".
const LOOKALIKES: Record<string, string> = {
  a: "@4",
  b: "8",
  e: "3",
  i: "1!|",
  o: "0",
  s: "$5",
  t: "7+",
  u: "0",
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Each maximal run of a letter in the root becomes a class of the letter plus
// its lookalikes, quantified by the run length: "ass" needs two s's (so the
// common word "as" stays clean) while "fuuuck" still matches "fuck".
function rootToPattern(root: string): string {
  let pattern = "";
  for (let i = 0; i < root.length; ) {
    let end = i;
    while (end < root.length && root[end] === root[i]) end++;
    const cls = `[${escapeRegExp(root[i])}${escapeRegExp(LOOKALIKES[root[i]] ?? "")}]`;
    const run = end - i;
    pattern += run > 1 ? `${cls}{${run},}` : `${cls}+`;
    i = end;
  }
  return pattern;
}

// Boundaries are \w lookarounds, not \b: \b fails when a match starts with a
// symbol ("$hit" has no word boundary before "$"). Substrings inside larger
// words stay clean ("classic", "Scunthorpe").
const PROFANITY_RE = new RegExp(
  `(?<!\\w)(?:${PROFANITY_ROOTS.map(rootToPattern).join("|")})(?!\\w)`,
  "i"
);

// Matching only — callers decide whether to mask, reject, or log. Fully
// spaced-out evasion ("f u c k") slips through by design: closing it requires
// dropping boundaries, which reintroduces the Scunthorpe problem.
export function containsProfanity(text: string): boolean {
  return PROFANITY_RE.test(text);
}

// Load-time self-check: a broken pattern must fail loudly at boot, not
// silently stop guarding.
assert(containsProfanity("f0ck"), "profanity matcher misses leet swap");
assert(containsProfanity("$h!t fuuuck"), "profanity matcher misses symbol/repeat evasion");
assert(!containsProfanity("a classic Scunthorpe as"), "profanity matcher false-positives");
