"""Derive token values from the contrast they have to hit, instead of guessing them.

Three helpers:
  clamp_chroma  - the largest in-gamut chroma at a given L/H, so nothing clips
  solve_l       - the lightness that lands a hue on an exact contrast ratio
  clip_delta    - how far a colour actually falls outside sRGB, in 0-255 steps
"""

import math

from tokens import contrast, oklch_to_srgb


def _raw_linear(L, C, H):
    hue = math.radians(H)
    a = C * math.cos(hue)
    b = C * math.sin(hue)
    l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    )


def _gamma(x):
    if x <= 0:
        return 0.0
    return 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055


def clip_delta(L, C, H):
    """Largest out-of-range excursion, expressed in 0-255 steps after gamma."""
    worst = 0.0
    for channel in _raw_linear(L, C, H):
        if channel < 0:
            worst = max(worst, abs(_gamma(-channel)) * 255)
        elif channel > 1:
            worst = max(worst, (_gamma(channel) - 1.0) * 255)
    return worst


def clamp_chroma(L, C, H, tolerance=0.5):
    """Reduce C until the colour sits inside sRGB (within half a 0-255 step)."""
    if clip_delta(L, C, H) <= tolerance:
        return C
    lo, hi = 0.0, C
    for _ in range(60):
        mid = (lo + hi) / 2
        if clip_delta(L, mid, H) <= tolerance:
            lo = mid
        else:
            hi = mid
    return round(lo, 4)


def solve_l(H, C, ground_rgb, target, darker=True, lo=0.0, hi=1.0):
    """The lightness at which (L, C, H) hits `target` contrast against a ground.

    `darker=True` searches below the ground (ink on a light page), False above.
    Chroma is clamped into gamut at every probe, so the answer is realisable.
    """
    for _ in range(80):
        mid = (lo + hi) / 2
        c = clamp_chroma(mid, C, H)
        got = contrast(oklch_to_srgb(mid, c, H), ground_rgb)
        if (got > target) == darker:
            lo = mid
        else:
            hi = mid
    L = round((lo + hi) / 2, 4)
    return L, clamp_chroma(L, C, H)


if __name__ == "__main__":
    from tokens import hex_of

    page_light = oklch_to_srgb(0.951, 0.003, 285)
    print("light page:", hex_of(0.951, 0.003, 285))
    for name, hue, chroma in (("success", 156, 0.15), ("warning", 62, 0.16),
                              ("info", 250, 0.16), ("destructive", 27, 0.22)):
        L, C = solve_l(hue, chroma, page_light, 4.5, darker=True)
        print(f"  {name:12} oklch({L} {C} {hue}) -> {hex_of(L, C, hue)}"
              f"  ratio {contrast(oklch_to_srgb(L, C, hue), page_light):.2f}")

    page_dark = oklch_to_srgb(0.148, 0.012, 285)
    print("dark page:", hex_of(0.148, 0.012, 285))
    for name, hue, chroma in (("success", 160, 0.15), ("warning", 78, 0.16),
                              ("info", 245, 0.13), ("destructive", 22, 0.20)):
        L, C = solve_l(hue, chroma, page_dark, 6.0, darker=False)
        print(f"  {name:12} oklch({L} {C} {hue}) -> {hex_of(L, C, hue)}"
              f"  ratio {contrast(oklch_to_srgb(L, C, hue), page_dark):.2f}")
