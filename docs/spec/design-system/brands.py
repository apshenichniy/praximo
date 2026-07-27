"""The recommended base, with only the brand hue moving.

Everything else — the neutral ramp, the raised control at a 1.75 edge, hairline
elevation, the tracking table — is held fixed, so the four columns differ in
exactly one thing.

Each brand is the most saturated value at its hue that clears **both** jobs the
token has to do on the light ground: white text on it as a fill (5.2:1) and
itself as text on the page (4.6:1). Solving only the first gives a brighter
colour that fails as a link at 4.35:1, which is how a brand token quietly becomes
two tokens later.
"""

from build import build, check

BRAND_HUES = [
    ("mark", "Знак", 283, "тон самого знака",
     (0.555, 0.2559, 283), (0.7113, 0.156, 283)),
    ("iris", "Iris", 299, "яркий кончик дуги — тоже из знака",
     (0.565, 0.2828, 299), (0.7175, 0.173, 299)),
    ("orchid", "Orchid", 311, "уже за пределами знака, но соседний",
     (0.567, 0.2854, 311), (0.7234, 0.199, 311)),
    ("fuchsia", "Fuchsia", 322, "полноценная фуксия",
     (0.565, 0.2685, 322), (0.7312, 0.241, 322)),
]

BASE = {
    "neutral_hue": 285, "neutral_chroma": (0.005, 0.024),
    "page_light": 0.951, "page_dark": 0.148,
    "control": "raised", "control_step": 0.040,
    # The one number moved off Practice: we already erred once toward "not
    # visible enough", so the control's edge goes to 1.75 rather than 1.55.
    "border_strength": 1.75,
    "brand_role": "primary",
    "shadow": "hairline",
    "type": "tracking",
    "warm": False,
}


def specs():
    out = {}
    for key, label, hue, note, light, dark in BRAND_HUES:
        out[f"b-{key}"] = {
            **BASE, "name": label, "tagline": f"H {hue}° · {note}",
            "brand": light, "brand_dark": dark,
        }
    return out


if __name__ == "__main__":
    failures = []
    print(f"{'':10}{'brand/page':>11}{'on-brand':>10}{'sel/ctrl':>10}"
          f"{'edge/page':>11}{'ctrl/page':>11}")
    for key, spec in specs().items():
        built = build(spec)
        report, fails = check(key, built)
        failures += fails
        r = report["light"]
        print(f"{spec['name']:10}{r['brand/page']:>11.2f}{r['on-brand/brand']:>10.2f}"
              f"{r['selected/control']:>10.2f}{r['control-edge/page']:>11.2f}"
              f"{r['control/page']:>11.2f}")
    print("\n" + ("\n".join(failures) if failures
                  else "none — every brand hue clears every gate in both schemes"))
