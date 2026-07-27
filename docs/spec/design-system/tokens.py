"""OKLCH -> sRGB, WCAG contrast, and the contrast gates the design system has to pass.

Mirrors apps/web/src/__tests__/theme-contrast.test.ts exactly (same folded matrix,
same WCAG 2 relative luminance) so a value that passes here passes there.
"""

import math


def _gamma(x):
    return 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055


def oklch_to_srgb(L, C, H):
    hue = math.radians(H)
    a = C * math.cos(hue)
    b = C * math.sin(hue)
    l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    rgb = (
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    )
    return tuple(min(1.0, max(0.0, _gamma(c))) for c in rgb)


def in_gamut(L, C, H, tol=1e-4):
    """True when the colour survives the sRGB clip unchanged."""
    hue = math.radians(H)
    a = C * math.cos(hue)
    b = C * math.sin(hue)
    l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    raw = (
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    )
    return all(-tol <= c <= 1 + tol for c in raw)


def hex_of(L, C, H):
    return "#" + "".join(f"{round(c * 255):02x}" for c in oklch_to_srgb(L, C, H))


def _linear(c):
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb):
    r, g, b = rgb
    return 0.2126 * _linear(r) + 0.7152 * _linear(g) + 0.0722 * _linear(b)


def contrast(rgb_a, rgb_b):
    la, lb = luminance(rgb_a), luminance(rgb_b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def over(ink, alpha, ground):
    """A translucent ink painted onto an opaque ground, the way a browser does it."""
    return tuple(i * alpha + g * (1 - alpha) for i, g in zip(ink, ground))


def max_chroma(L, H, ceiling=0.4, steps=4000):
    """The largest in-gamut chroma at this lightness and hue."""
    best = 0.0
    for i in range(steps + 1):
        c = ceiling * i / steps
        if in_gamut(L, c, H):
            best = c
        else:
            break
    return best


# --- self-test against the values the palette agent verified -------------------
if __name__ == "__main__":
    assert hex_of(1.0, 0.0, 0.0) == "#ffffff", hex_of(1.0, 0.0, 0.0)
    assert hex_of(0.6280, 0.2577, 29.23) == "#ff0000", hex_of(0.6280, 0.2577, 29.23)
    assert hex_of(0.4175, 0.2071, 282.78) == "#4627b6", hex_of(0.4175, 0.2071, 282.78)
    print("conversion self-test ok")
    print("brand indigo  oklch(0.42 0.207 282.8) ->", hex_of(0.42, 0.207, 282.8))
    print("arc bright    oklch(0.556 0.246 289.7) ->", hex_of(0.556, 0.246, 289.7))
    print("max chroma at L=0.42 H=282.8:", round(max_chroma(0.42, 282.8), 4))
    print("max chroma at L=0.62 H=282.8:", round(max_chroma(0.62, 282.8), 4))
    print("max chroma at L=0.72 H=282.8:", round(max_chroma(0.72, 282.8), 4))
