"""Put one brand set into the app.

    python3 docs/spec/design-system/apply.py iris

Three files restate these values, and all three have to move together:

  styles/app.css      the tokens themselves
  routes/__root.tsx   the critical stylesheet, which carries both grounds inline
                      because the scheme is not known a few bytes further down
                      the head — `global-theme.test.tsx` asserts these match
  lib/theme.ts        the hexadecimal boundaries: the Telegram host chrome, the
                      `theme-color` meta, and the pre-oklch fallback. Telegram is
                      handed colours through a bridge call, not CSS, so it cannot
                      read a token.

Leaving any of the three behind is silent: the app renders, the tests fail on one
of them, and the Telegram chrome keeps the colour of the set before.
"""

import pathlib
import re
import sys

from sets import SETS, block  # noqa: F401  (block is used via render)
from sets import BASE
from build import build
from tokens import hex_of

ROOT = pathlib.Path(__file__).resolve().parents[3]
WEB = ROOT / "apps" / "web" / "src"


def oklch(value):
    return f"oklch({value[0]:.4g} {value[1]:.4g} {value[2]:.4g})"


def apply(key):
    if key not in SETS:
        raise SystemExit(f"unknown set {key!r} — one of {', '.join(SETS)}")

    css_path = pathlib.Path(__file__).parent / "sets" / f"{key}.css"
    if not css_path.exists():
        raise SystemExit(f"{css_path} is missing — run `python3 sets.py` first")

    spec = {**BASE, "name": SETS[key]["title"], "tagline": key,
            "brand": SETS[key]["brand"], "brand_dark": SETS[key]["brand_dark"]}
    built = build(spec)
    light, dark = built["light"], built["dark"]

    # --- 1. the tokens -------------------------------------------------------
    generated = css_path.read_text(encoding="utf-8")
    blocks = re.search(r"(:root \{.*?\n\}\n\n\.dark \{.*?\n\})", generated, re.S)
    if blocks is None:
        raise SystemExit(f"could not read the token blocks out of {css_path}")

    app_css_path = WEB / "styles" / "app.css"
    app_css = app_css_path.read_text(encoding="utf-8")
    replaced, count = re.subn(
        r":root \{.*?\n\}\n\n\.dark \{.*?\n\}", blocks.group(1), app_css, count=1, flags=re.S)
    if count != 1:
        raise SystemExit("app.css does not have the expected `:root` … `.dark` pair")
    app_css_path.write_text(replaced, encoding="utf-8")

    # --- 2. the critical stylesheet -----------------------------------------
    root_path = WEB / "routes" / "__root.tsx"
    root = root_path.read_text(encoding="utf-8")
    for name, value in (("darkBackground", dark["background"]),
                        ("darkForeground", dark["foreground"]),
                        ("lightBackground", light["background"]),
                        ("lightForeground", light["foreground"])):
        root, n = re.subn(rf'const {name} = "[^"]*"',
                          f'const {name} = "{oklch(value)}"', root, count=1)
        if n != 1:
            raise SystemExit(f"__root.tsx has no `const {name}`")
    root_path.write_text(root, encoding="utf-8")

    # --- 3. the hexadecimal boundaries --------------------------------------
    theme_path = WEB / "lib" / "theme.ts"
    theme = theme_path.read_text(encoding="utf-8")
    for name, dark_token, light_token in (
        # The Telegram chrome — header, webview background, bottom bar — borders
        # the *page*, so it is the page's colour. Mapping it to `card` put pure
        # white around a receded light page, and an overscroll showed the seam as
        # a white band above the content (#198). `theme-color` is the same
        # boundary in a plain browser.
        ("APP_SURFACE_COLOR", "background", "background"),
        ("APP_BACKGROUND_COLOR", "background", "background"),
        ("APP_FOREGROUND_COLOR", "foreground", "foreground"),
        ("APP_PRIMARY_COLOR", "primary", "primary"),
        ("APP_ON_PRIMARY_COLOR", "primary-foreground", "primary-foreground"),
    ):
        pair = (f'{{ dark: "{hex_of(*dark[dark_token][:3])}", '
                f'light: "{hex_of(*light[light_token][:3])}" }}')
        theme, n = re.subn(rf"export const {name}: SchemeColor = \{{[^}}]*\}}",
                           f"export const {name}: SchemeColor = {pair}", theme, count=1)
        if n != 1:
            raise SystemExit(f"theme.ts has no `{name}`")
    theme_path.write_text(theme, encoding="utf-8")

    print(f"applied {SETS[key]['title']}  brand {hex_of(*SETS[key]['brand'])}")
    print(f"  {app_css_path.relative_to(ROOT)}")
    print(f"  {root_path.relative_to(ROOT)}")
    print(f"  {theme_path.relative_to(ROOT)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: apply.py <{'|'.join(SETS)}>")
    apply(sys.argv[1])
