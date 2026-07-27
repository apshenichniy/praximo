"""Emit the four brand sets as complete `:root` / `.dark` blocks.

All four share the recommended base — raised control at a 1.75 edge, hairline
elevation, the tracking table, brand in the `primary` role — and differ only in
the brand hue. Swapping one for another is what `apply.py` does; nothing else in
the design system moves between them.

    python3 sets.py            # writes sets/*.css
"""

import pathlib

from build import build, check
from tokens import hex_of

HERE = pathlib.Path(__file__).parent
OUT = HERE / "sets"

BASE = {
    "neutral_hue": 285, "neutral_chroma": (0.005, 0.024),
    "page_light": 0.951, "page_dark": 0.148,
    "control": "raised", "control_step": 0.040,
    "border_strength": 1.75,
    "brand_role": "primary",
    "shadow": "hairline", "type": "tracking", "warm": False,
}

SETS = {
    "origin": {
        "title": "Origin",
        "why": "The brand as first proposed, before it was brightened — the mark's\n   hue at the lightness Practice carried.",
        "brand": (0.435, 0.205, 283), "brand_dark": (0.660, 0.180, 287),
    },
    "mark": {
        "title": "Mark",
        "why": "The mark's own hue, taken to the most saturated value sRGB holds\n   there that still works as both a fill and as text on the page.",
        "brand": (0.555, 0.2559, 283), "brand_dark": (0.7113, 0.156, 283),
    },
    "iris": {
        "title": "Iris",
        "why": "H 299 — where the arc's bright tip already measures in the light\n   master, so it is still literally in the artwork while reading\n   distinctly more magenta than the mark's body.",
        "brand": (0.565, 0.2828, 299), "brand_dark": (0.7175, 0.173, 299),
    },
    "fuchsia": {
        "title": "Fuchsia",
        "why": "H 322 — a full fuchsia. Leaves the mark behind; the logo becomes\n   the odd one out until #145's artwork is redone.",
        "brand": (0.565, 0.2685, 322), "brand_dark": (0.7312, 0.241, 322),
    },
}

# Tokens the shadcn preset needs that this generator does not derive. The sidebar
# family is unused by either app today but a CLI-pulled component expects it, and
# the charts likewise; both are mapped onto the new ramp rather than left on the
# old cyan one.
def trailing(scheme, mode):
    def h(name):
        return hex_of(*scheme[name][:3])
    if mode == "light":
        chart = [(0.872, 0.010, 285), (0.560, 0.030, 285), (0.450, 0.024, 285),
                 (0.378, 0.020, 285), (0.275, 0.016, 285)]
    else:
        chart = [(0.872, 0.010, 285), (0.560, 0.030, 285), (0.450, 0.024, 285),
                 (0.378, 0.020, 285), (0.275, 0.016, 285)]
    lines = [f"  --chart-{i + 1}: oklch({c[0]:.4g} {c[1]:.4g} {c[2]:.4g});"
             for i, c in enumerate(chart)]
    if mode == "light":
        lines.append("  --radius: 0.625rem;")
    lines += [
        f"  --sidebar: {h('card')};",
        f"  --sidebar-foreground: {h('foreground')};",
        f"  --sidebar-primary: {h('primary')};",
        f"  --sidebar-primary-foreground: {h('primary-foreground')};",
        f"  --sidebar-accent: {h('accent')};",
        f"  --sidebar-accent-foreground: {h('accent-foreground')};",
        f"  --sidebar-border: {h('border')};",
        f"  --sidebar-ring: {h('ring')};",
    ]
    return lines


ORDER = [
    ("Surfaces — the grounds content sits on. Never the fill of a control.",
     ["background", "foreground", "card", "card-foreground",
      "popover", "popover-foreground", "muted", "muted-foreground"]),
    ("Controls — the things a thumb chooses. `--control-border` is what makes a\n     control read as one, and it applies even when the control has a fill.",
     ["primary", "primary-foreground", "secondary", "secondary-foreground",
      "control-border", "accent", "accent-foreground", "border", "input", "ring"]),
    ("Brand — the mark's violet. `--primary` carries it in this set, so the two\n     are the same value; they are still separate tokens because the role is.",
     ["brand", "brand-foreground", "brand-surface", "brand-border"]),
    ("Status — meaning, never hue. Each carries a surface so a tinted state has\n     a token instead of an improvised alpha.",
     ["destructive", "destructive-surface", "success", "success-surface",
      "warning", "warning-surface", "info", "info-surface"]),
    ("State — a press is ink, so it darkens whatever surface it lands on.",
     ["pressed"]),
]


def block(scheme, mode):
    lines = [f"  color-scheme: {mode};"]
    for heading, names in ORDER:
        lines.append(f"\n  /* {heading} */")
        for name in names:
            value = scheme[name]
            if len(value) == 4:
                base = "0 0 0" if value[0] == 0 else "1 0 0"
                lines.append(f"  --{name}: oklch({base} / {value[3] * 100:.0f}%);")
            else:
                lines.append(f"  --{name}: oklch({value[0]:.4g} {value[1]:.4g} {value[2]:.4g});")
    lines.append("")
    lines += trailing(scheme, mode)
    return "\n".join(lines)


def render(key):
    spec = {**BASE, "name": SETS[key]["title"], "tagline": key,
            "brand": SETS[key]["brand"], "brand_dark": SETS[key]["brand_dark"]}
    built = build(spec)
    _, failures = check(key, built)
    if failures:
        raise SystemExit("\n".join(failures))

    L, C, H = SETS[key]["brand"]
    why = "\n * ".join(line.strip() for line in SETS[key]["why"].split("\n"))
    return f"""/* Praximo design system — brand set: {SETS[key]['title']} (#198)
 *
 * {why}
 *
 * Brand: oklch({L:.4g} {C:.4g} {H}) = {hex_of(L, C, H)} on the light ground.
 * Every other value is shared with the other three sets and is derived from a
 * contrast target rather than chosen — see ../README.md and ../build.py.
 *
 * Applied with:  python3 docs/spec/design-system/apply.py {key}
 * That rewrites the token blocks in apps/web/src/styles/app.css and keeps
 * routes/__root.tsx and lib/theme.ts, which restate some of these values outside
 * CSS, in step with them.
 */

:root {{
{block(built['light'], 'light')}
}}

.dark {{
{block(built['dark'], 'dark')}
}}
"""


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for key in SETS:
        (OUT / f"{key}.css").write_text(render(key), encoding="utf-8")
        print(f"wrote sets/{key}.css")
