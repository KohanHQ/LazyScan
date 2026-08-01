#!/usr/bin/env python3
"""Order-aware CSS conflict checker for stylesheet moves.

Two rules with equal specificity that set the same property on an element that
matches both are decided by DOCUMENT ORDER, not specificity. Moving a rule
between files (or within one) can silently flip which one wins. The screenshot
harness is structurally blind to this whenever the flipped property is
`transition`, because its KILL_MOTION injection disables transitions outright.

Built during Tailwind migration Stage 5 (home pass B), where it caught a move of
`.rail-cover img, .manga-cover img { transition: transform }` past
`img.cover-fade { transition: opacity }` — a real regression the shot diff could
not see. Promoted to a first-class tool for Stage 6.

Usage:

    python3 web/visual/cssorder.py OLD... -- NEW...

e.g.

    python3 web/visual/cssorder.py \
      web/src/styles/base.css web/src/styles/effects.css -- \
      web/src/styles/tokens.css web/src/styles/reset.css \
      web/src/styles/components.css web/src/styles/effects.css

Files are concatenated in the order given — that must match the order the
browser sees them (import order), or the answer is meaningless.

Exit status is 1 if any conflicting pair changed relative order, 0 otherwise.
Rules that exist on only one side are reported separately: a pure move should
add and drop nothing.

Deliberately approximate, in the safe direction: "could match the same element"
is a shared-token test on the selectors, and specificity is not computed at all,
so unequal-specificity pairs are reported too. It over-reports; it does not
under-report the shape of conflict it exists to find.
"""

import pathlib
import re
import sys


def rules(path):
    """[(at-rule context, selector, declaration body)] in document order."""
    css = re.sub(r"/\*.*?\*/", "", pathlib.Path(path).read_text(), flags=re.S)
    out = []

    def parse(s, a, b, ctx):
        i = a
        while i < b:
            o = s.find("{", i)
            if o < 0 or o >= b:
                break
            sel = s[i:o].strip()
            d, j = 1, o + 1
            while j < b and d:
                if s[j] == "{":
                    d += 1
                elif s[j] == "}":
                    d -= 1
                j += 1
            if sel.startswith("@keyframes"):
                # Name-scoped and order-independent; never a cascade conflict.
                pass
            elif sel.startswith("@"):
                parse(s, o + 1, j - 1, ctx + [re.sub(r"\s+", " ", sel)])
            else:
                out.append((tuple(ctx), re.sub(r"\s+", " ", sel), s[o + 1 : j - 1]))
            i = j

    parse(css, 0, len(css), [])
    return out


def props(body):
    return set(p.split(":")[0].strip() for p in body.split(";") if ":" in p)


def toks(sel):
    return set(re.findall(r"[.#]?[\w-]+", sel))


def flatten(files):
    seq = []
    for f in files:
        for ctx, sel, body in rules(f):
            seq.append((ctx, sel, props(body), toks(sel)))
    return seq


def conflicts(seq):
    """pairs (i<j) that could both match one element and set a shared property"""
    out = []
    for i in range(len(seq)):
        for j in range(i + 1, len(seq)):
            a, b = seq[i], seq[j]
            if a[2] & b[2] and a[3] & b[3]:
                out.append(((a[0], a[1]), (b[0], b[1])))
    return out


def key(rule):
    """Identity of a rule across the move: at-rule context + selector."""
    return (rule[0], rule[1])


def main(argv):
    if "--" not in argv:
        sys.exit(__doc__)
    cut = argv.index("--")
    old_files, new_files = argv[:cut], argv[cut + 1 :]
    if not old_files or not new_files:
        sys.exit(__doc__)

    old, new = flatten(old_files), flatten(new_files)
    old_pos, new_pos = {}, {}
    for i, r in enumerate(old):
        old_pos.setdefault(key(r), i)
    for i, r in enumerate(new):
        new_pos.setdefault(key(r), i)

    dropped = sorted(set(old_pos) - set(new_pos))
    added = sorted(set(new_pos) - set(old_pos))

    pairs = conflicts(old)
    flips = []
    unchecked = 0
    for a, b in pairs:
        if a not in new_pos or b not in new_pos:
            unchecked += 1
            continue
        if new_pos[a] > new_pos[b]:
            flips.append((a, b))

    print(f"old: {len(old)} rules over {len(old_files)} file(s)")
    print(f"new: {len(new)} rules over {len(new_files)} file(s)")
    print(f"conflict pairs checked: {len(pairs) - unchecked} (of {len(pairs)})")

    for label, items in (("dropped", dropped), ("added", added)):
        print(f"{label}: {len(items)}")
        for ctx, sel in items[:20]:
            print(f"  {' '.join(ctx)} {sel}")
        if len(items) > 20:
            print(f"  ... {len(items) - 20} more")

    print(f"ORDER FLIPS: {len(flips)}")
    for a, b in flips[:40]:
        print(f"  {' '.join(a[0])} {a[1]}")
        print(f"    now loses to / wins over: {' '.join(b[0])} {b[1]}")
    if len(flips) > 40:
        print(f"  ... {len(flips) - 40} more")

    return 1 if (flips or dropped or added) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
