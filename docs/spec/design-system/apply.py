"""Put one brand set into both apps.

    python3 docs/spec/design-system/apply.py iris

Three files per app restate these values, and all of them have to move together:

  styles/app.css      the tokens themselves
  routes/__root.tsx   the critical stylesheet, which carries both grounds inline
                      because the scheme is not known a few bytes further down
                      the head — `global-theme.test.tsx` asserts these match
  lib/theme.ts        the hexadecimal boundaries: the Telegram host chrome, the
                      `theme-color` meta, and the pre-oklch fallback. Telegram is
                      handed colours through a bridge call, not CSS, so it cannot
                      read a token.

Six files since #191, because `apps/client` carries the same system. Leaving any
of them behind is silent: the app renders, the tests fail on one of them, and the
Telegram chrome keeps the colour of the set before.
"""

import pathlib
import re
import sys

from sets import SETS, block  # noqa: F401  (block is used via render)
from sets import BASE
from build import build
from tokens import hex_of

ROOT = pathlib.Path(__file__).resolve().parents[3]

# Every app that carries the system. Two since #191, and the reason the loop
# below exists at all: the token blocks are duplicated between them on purpose
# (there is no `@praximo/theme` package yet — see README §Extraction trigger),
# so the only thing keeping the copies honest is that one command writes both.
# `design-system-parity.test.ts` is the alarm for a run that did not happen.
APPS = [ROOT / "apps" / "web" / "src", ROOT / "apps" / "client" / "src"]


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

    generated = css_path.read_text(encoding="utf-8")
    blocks = re.search(r"(:root \{.*?\n\}\n\n\.dark \{.*?\n\})", generated, re.S)
    if blocks is None:
        raise SystemExit(f"could not read the token blocks out of {css_path}")

    print(f"applied {SETS[key]['title']}  brand {hex_of(*SETS[key]['brand'])}")
    for app in APPS:
        for written in apply_to_app(app, blocks.group(1), light, dark):
            print(f"  {written.relative_to(ROOT)}")


def apply_to_app(app, token_blocks, light, dark):
    """Write the three files of one app. Returns them, in the order written."""

    # --- 1. the tokens -------------------------------------------------------
    app_css_path = app / "styles" / "app.css"
    app_css = app_css_path.read_text(encoding="utf-8")
    replaced, count = re.subn(
        r":root \{.*?\n\}\n\n\.dark \{.*?\n\}", token_blocks, app_css, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{app_css_path} has no `:root` … `.dark` pair")
    app_css_path.write_text(replaced, encoding="utf-8")

    # --- 2. the critical stylesheet -----------------------------------------
    root_path = app / "routes" / "__root.tsx"
    root = root_path.read_text(encoding="utf-8")
    for name, value in (("darkBackground", dark["background"]),
                        ("darkForeground", dark["foreground"]),
                        ("lightBackground", light["background"]),
                        ("lightForeground", light["foreground"])):
        root, n = re.subn(rf'const {name} = "[^"]*"',
                          f'const {name} = "{oklch(value)}"', root, count=1)
        if n != 1:
            raise SystemExit(f"{root_path} has no `const {name}`")
    root_path.write_text(root, encoding="utf-8")

    # --- 3. the hexadecimal boundaries --------------------------------------
    theme_path = app / "lib" / "theme.ts"
    theme = theme_path.read_text(encoding="utf-8")
    # Not every app declares every one of these. The last two are the Telegram
    # bottom button, painted through a bridge call, and `apps/client` has no
    # bridge — so a constant a file does not declare is skipped rather than
    # demanded.
    #
    # What must not happen is a *renamed* constant reading as an absent one: that
    # is exactly the silent half-application this script exists to prevent. So
    # the file is asked how many it declares, and every one of them has to be
    # rewritten. Absent is fine; present-and-unmatched is not.
    declared = len(re.findall(r"export const \w+: SchemeColor = ", theme))
    if declared == 0:
        raise SystemExit(f"{theme_path} declares no SchemeColor constants")
    written = 0
    for name, dark_token, light_token in (
        # The Telegram chrome — header, webview background, bottom bar — borders
        # the *page*, so it is the page's colour. Mapping it to `card` put pure
        # white around a receded light page, and an overscroll showed the seam as
        # a white band above the content (#198). `theme-color` is the same
        # boundary in a plain browser, which is the only one of these the client
        # app has — it is handed no colours across a bridge.
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
        written += n
    if written != declared:
        raise SystemExit(
            f"{theme_path} declares {declared} SchemeColor constants but {written} were written — "
            "one of them is named something this script does not know")
    theme_path.write_text(theme, encoding="utf-8")

    return [app_css_path, root_path, theme_path]


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: apply.py <{'|'.join(SETS)}>")
    apply(sys.argv[1])
