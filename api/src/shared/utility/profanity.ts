import assert from "node:assert";

// Root-shaped and small on purpose: the matchers, not the list, carry the
// evasion resistance. Comments mask matches; the bio rejects the whole value.
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

// `0` sits under both `o` and `u` so f0ck-style swaps resolve to the intended
// root, not the literal "fock".
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

// Run length is quantified so "ass" needs both s's (the common word "as" stays
// clean) while "fuuuck" still matches "fuck".
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

// \w lookarounds, not \b: \b fails when a match starts with a symbol ("$hit").
// Substrings inside larger words stay clean ("Scunthorpe").
const PROFANITY_RE = new RegExp(
  `(?<!\\w)(?:${PROFANITY_ROOTS.map(rootToPattern).join("|")})(?!\\w)`,
  "i"
);

// Spaced-out evasion ("f u c k") slips through by design: closing it means
// dropping boundaries, which reintroduces the Scunthorpe problem.
export function containsProfanity(text: string): boolean {
  return PROFANITY_RE.test(text);
}

// Masking stays on plain \b roots: it replaces in the raw text, where the
// stricter matcher's normalized classes cannot map back to original positions.
const MASK_RE = new RegExp(`\\b(?:${PROFANITY_ROOTS.join("|")})\\b`, "gi");

// Word-boundary, case-insensitive: "ass" matches standalone but not "class".
export function maskProfanity(text: string): string {
  return text.replace(MASK_RE, (match) => "*".repeat(match.length));
}

// Load-time self-check: a broken pattern must fail loudly at boot, not
// silently stop guarding.
assert(containsProfanity("f0ck"), "profanity matcher misses leet swap");
assert(containsProfanity("$h!t fuuuck"), "profanity matcher misses symbol/repeat evasion");
assert(!containsProfanity("a classic Scunthorpe as"), "profanity matcher false-positives");
