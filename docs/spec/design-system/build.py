"""Build the four design-system variants from their design decisions.

A variant states only what is actually decided — the neutral hue, how far the
page recedes, which direction a control moves from the page, the brand colour
and how loud its role is. Every other value is derived from a contrast target,
so no number in the output was chosen by eye.
"""

import json

from solve import clamp_chroma, solve_l
from tokens import contrast, hex_of, oklch_to_srgb, over

# --- the decisions ------------------------------------------------------------
# control: "raised"   - the control lifts off the page, like an iOS list row
#          "recessed" - the control is cut into the page, like a filled chip
VARIANTS = {
    "orbit": {
        "name": "Orbit",
        "tagline": "система уходит с дороги",
        "neutral_hue": 285, "neutral_chroma": (0.004, 0.020),
        "page_light": 0.949, "page_dark": 0.148,
        "control": "raised", "control_step": 0.040, "border_strength": 1.62,
        "brand": (0.468, 0.200, 283), "brand_dark": (0.735, 0.150, 285),
        "brand_role": "tint",
        "shadow": "hairline",
        "type": "tracking",
        "warm": False,
    },
    "practice": {
        "name": "Practice",
        "tagline": "у практики есть цвет",
        "neutral_hue": 285, "neutral_chroma": (0.006, 0.028),
        "page_light": 0.956, "page_dark": 0.150,
        "control": "raised", "control_step": 0.034, "border_strength": 1.55,
        "brand": (0.435, 0.205, 283), "brand_dark": (0.660, 0.180, 287),
        "brand_role": "primary",
        "shadow": "soft",
        "type": "weight",
        "warm": False,
    },
    "studio": {
        "name": "Studio",
        "tagline": "фиолетовый насквозь",
        "neutral_hue": 284, "neutral_chroma": (0.014, 0.048),
        "page_light": 0.970, "page_dark": 0.158,
        "control": "recessed", "control_step": 0.052, "border_strength": 1.30,
        "brand": (0.402, 0.132, 284), "brand_dark": (0.706, 0.128, 286),
        "brand_role": "primary",
        "shadow": "layered",
        "type": "retuned",
        "warm": False,
    },
    "signal": {
        "name": "Signal",
        "tagline": "ничего двусмысленного",
        "neutral_hue": 285, "neutral_chroma": (0.004, 0.022),
        "page_light": 0.941, "page_dark": 0.138,
        "control": "raised", "control_step": 0.059, "border_strength": 2.00,
        "brand": (0.482, 0.230, 288), "brand_dark": (0.690, 0.170, 290),
        "brand_role": "primary",
        "shadow": "overlay-only",
        "type": "legible",
        "warm": True,
    },
}

STATUS_HUES = {"success": 156, "warning": 62, "info": 250, "destructive": 27}
STATUS_HUES_DARK = {"success": 160, "warning": 82, "info": 245, "destructive": 22}


def tint(base, page_l, hue, chroma_share=0.16, lift=0.012):
    """A pale wash of a colour, sitting just off the page rather than mid-way to it.

    Solved the other way round from the ink it carries: the surface is fixed pale
    and the *ratio* is then asserted, because a tint that satisfies 4.5:1 by
    getting darker stops being a tint.
    """
    L = min(0.985, page_l - lift)
    return (L, clamp_chroma(L, base[1] * chroma_share, hue), hue)


def tint_dark(base, page_l, hue, chroma_share=0.30, drop=0.135, floor=4.6):
    """As `tint`, but on a dark ground the wash rises off the page instead.

    Starts at the intended lift and steps back down only as far as the ink on it
    demands — so the surface is the palest one that still carries its own text.
    """
    ink = oklch_to_srgb(*base[:3])
    for step in range(0, 60):
        L = drop + page_l - step * 0.004
        if L <= page_l:
            break
        C = clamp_chroma(L, base[1] * chroma_share, hue)
        if contrast(ink, oklch_to_srgb(L, C, hue)) >= floor:
            return (round(L, 4), C, hue)
    L = page_l + 0.02
    return (L, clamp_chroma(L, base[1] * chroma_share, hue), hue)


def solve_press_alpha(surface_rgb, page_rgb, ink_rgb, floor=1.20, page_floor=1.14):
    """The least ink that both answers the press and stays off the page's colour."""
    for step in range(4, 40):
        alpha = step / 100
        pressed = over(ink_rgb, alpha, surface_rgb)
        if (contrast(pressed, surface_rgb) >= floor
                and contrast(pressed, page_rgb) >= page_floor):
            return alpha
    return 0.20


def build(spec):
    hue = spec["neutral_hue"]
    c_lo, c_hi = spec["neutral_chroma"]
    out = {}

    # ------------------------------------------------------------------ light --
    page_l = spec["page_light"]
    page = (page_l, clamp_chroma(page_l, c_lo, hue), hue)
    page_rgb = oklch_to_srgb(*page)
    card = (1.0, 0.0, 0)

    # Running text: solved to land just past the shipped 17:1, not guessed.
    fg_l, fg_c = solve_l(hue, c_hi * 0.7, page_rgb, 17.0, darker=True)
    fg = (fg_l, fg_c, hue)

    # Secondary text at 7.0:1 — the value #194 settled on, now derived.
    mfg_l, mfg_c = solve_l(hue, c_hi, page_rgb, 7.0, darker=True)
    mfg = (mfg_l, mfg_c, hue)

    if spec["control"] == "raised":
        ctrl_l = min(1.0, page_l + spec["control_step"])
    else:
        ctrl_l = page_l - spec["control_step"]
    control = (ctrl_l, clamp_chroma(ctrl_l, c_lo * 1.6, hue), hue)
    control_rgb = oklch_to_srgb(*control)

    # The control's edge, solved against the fill it sits on.
    cb_l, cb_c = solve_l(hue, c_hi * 0.6, control_rgb, spec["border_strength"], darker=True)
    control_border = (cb_l, cb_c, hue)

    # The plain hairline has two grounds to hold on, and the page is the harder
    # of them now that it has receded — so it is solved there. Against the card,
    # which is lighter still, it can only read stronger.
    bd_l, bd_c = solve_l(hue, c_hi * 0.4, page_rgb, 1.22, darker=True)
    border = (bd_l, bd_c, hue)

    muted_l = page_l - 0.028 if spec["control"] == "raised" else page_l - 0.038
    muted = (muted_l, clamp_chroma(muted_l, c_lo * 2.2, hue), hue)

    # `accent` is the hover wash, and hover happens on raised surfaces — a menu
    # item in a popover, a row in a card. So it is solved against the card, not
    # against a page it never lands on.
    ac_l, ac_c = solve_l(hue, c_hi * 0.5, oklch_to_srgb(*card), 1.12, darker=True)
    accent = (ac_l, ac_c, hue)

    brand = (spec["brand"][0], clamp_chroma(*spec["brand"]), spec["brand"][2])
    brand_hue = spec["brand"][2]
    brand_surface = tint(brand, page_l, brand_hue)
    bb_l, bb_c = solve_l(brand_hue, spec["brand"][1] * 0.42,
                         oklch_to_srgb(*brand_surface), 1.45, darker=True)
    brand_border = (bb_l, bb_c, brand_hue)

    primary = brand if spec["brand_role"] == "primary" else (
        solve_l(hue, c_hi, page_rgb, 13.0, darker=True)[0],
        solve_l(hue, c_hi, page_rgb, 13.0, darker=True)[1], hue)

    light = {
        "background": page, "foreground": fg,
        "card": card, "card-foreground": fg,
        "popover": card, "popover-foreground": fg,
        "muted": muted, "muted-foreground": mfg,
        "primary": primary, "primary-foreground": (0.992, 0.003, hue),
        "secondary": control, "secondary-foreground": fg,
        "control-border": control_border,
        "accent": accent, "accent-foreground": fg,
        "border": border, "input": border,
        "ring": brand,
        "brand": brand, "brand-foreground": (0.992, 0.003, hue),
        "brand-surface": brand_surface, "brand-border": brand_border,
        # Solved, not assumed: a press on a white card has to stay clear of the
        # page behind it, and the further the page has receded the more ink that
        # takes. A fixed 10% was right for one page lightness only (#196).
        "pressed": (0, 0, 0, solve_press_alpha(oklch_to_srgb(*card), page_rgb, (0, 0, 0))),
    }
    for name, status_hue in STATUS_HUES.items():
        chroma = 0.22 if name == "destructive" else 0.15
        L, C = solve_l(status_hue, chroma, page_rgb, 4.6, darker=True)
        light[name] = (L, C, status_hue)
        light[f"{name}-surface"] = tint((L, C, status_hue), page_l, status_hue)
    if spec["warm"]:
        L, C = solve_l(58, 0.16, page_rgb, 4.6, darker=True)
        light["warm"] = (L, C, 58)
        light["warm-surface"] = tint((L, C, 58), page_l, 58)

    # ------------------------------------------------------------------- dark --
    page_l_d = spec["page_dark"]
    page_d = (page_l_d, clamp_chroma(page_l_d, c_hi * 0.55, hue), hue)
    page_d_rgb = oklch_to_srgb(*page_d)

    fgd_l, fgd_c = solve_l(hue, c_lo, page_d_rgb, 17.6, darker=False)
    fg_d = (fgd_l, fgd_c, hue)

    # Parity with the light scheme, which is what the shipped test asserts.
    mfgd_l, mfgd_c = solve_l(hue, c_hi, page_d_rgb, 7.9, darker=False)
    mfg_d = (mfgd_l, mfgd_c, hue)

    card_l = page_l_d + 0.066
    card_d = (card_l, clamp_chroma(card_l, c_hi * 0.75, hue), hue)

    ctrl_l_d = page_l_d + (0.118 if spec["control"] == "raised" else 0.142)
    control_d = (ctrl_l_d, clamp_chroma(ctrl_l_d, c_hi * 0.85, hue), hue)
    control_d_rgb = oklch_to_srgb(*control_d)

    cbd_l, cbd_c = solve_l(hue, c_hi * 1.4, control_d_rgb, spec["border_strength"], darker=False)
    control_border_d = (cbd_l, cbd_c, hue)

    bdd_l, bdd_c = solve_l(hue, c_hi, oklch_to_srgb(*card_d), 1.26, darker=False)
    border_d = (bdd_l, bdd_c, hue)

    muted_l_d = card_l + 0.062
    muted_d = (muted_l_d, clamp_chroma(muted_l_d, c_hi, hue), hue)
    accent_l_d = ctrl_l_d + 0.048
    accent_d = (accent_l_d, clamp_chroma(accent_l_d, c_hi * 1.2, hue), hue)

    brand_d = (spec["brand_dark"][0], clamp_chroma(*spec["brand_dark"]), spec["brand_dark"][2])
    brand_hue_d = spec["brand_dark"][2]
    brand_surface_d = tint_dark(brand_d, page_l_d, brand_hue_d)
    bbd_l, bbd_c = solve_l(brand_hue_d, spec["brand_dark"][1] * 0.68,
                           oklch_to_srgb(*brand_surface_d), 1.45, darker=False)
    brand_border_d = (bbd_l, bbd_c, brand_hue_d)

    primary_d = brand_d if spec["brand_role"] == "primary" else (
        *solve_l(hue, c_lo, page_d_rgb, 13.5, darker=False), hue)

    dark = {
        "background": page_d, "foreground": fg_d,
        "card": card_d, "card-foreground": fg_d,
        "popover": card_d, "popover-foreground": fg_d,
        "muted": muted_d, "muted-foreground": mfg_d,
        "primary": primary_d,
        "primary-foreground": (page_l_d + 0.03, clamp_chroma(page_l_d + 0.03, c_hi, hue), hue),
        "secondary": control_d, "secondary-foreground": fg_d,
        "control-border": control_border_d,
        "accent": accent_d, "accent-foreground": fg_d,
        "border": border_d, "input": border_d,
        "ring": brand_d,
        "brand": brand_d,
        "brand-foreground": (page_l_d + 0.03, clamp_chroma(page_l_d + 0.03, c_hi, hue), hue),
        "brand-surface": brand_surface_d, "brand-border": brand_border_d,
        "pressed": (1, 0, 0, solve_press_alpha(oklch_to_srgb(*card_d), page_d_rgb, (1, 1, 1))),
    }
    for name, status_hue in STATUS_HUES_DARK.items():
        chroma = 0.20 if name == "destructive" else 0.15
        L, C = solve_l(status_hue, chroma, page_d_rgb, 8.0, darker=False)
        dark[name] = (L, C, status_hue)
        dark[f"{name}-surface"] = tint_dark((L, C, status_hue), page_l_d, status_hue)
    if spec["warm"]:
        L, C = solve_l(66, 0.15, page_d_rgb, 8.0, darker=False)
        dark["warm"] = (L, C, 66)
        dark["warm-surface"] = tint_dark((L, C, 66), page_l_d, 66)

    out["light"], out["dark"] = light, dark
    return out


# --- gates --------------------------------------------------------------------
def ratio(scheme, a, b):
    return contrast(oklch_to_srgb(*scheme[a][:3]), oklch_to_srgb(*scheme[b][:3]))


GATES_BOTH = [
    ("fg/page", "foreground", "background", 15.0),
    ("muted-fg/page", "muted-foreground", "background", 6.5),
    ("card/page", "card", "background", 1.05),
    ("muted/card", "muted", "card", 1.10),
    # The three that do not exist yet: a control has to read as a control.
    ("control/page", "secondary", "background", 1.08),
    ("control-edge/page", "control-border", "background", 1.40),
    ("control-edge/control", "control-border", "secondary", 1.25),
    ("selected/control", "primary", "secondary", 2.00),
    ("on-primary/primary", "primary-foreground", "primary", 4.50),
    ("brand/page", "brand", "background", 4.50),
    ("on-brand/brand", "brand-foreground", "brand", 4.50),
    ("brand/brand-surface", "brand", "brand-surface", 4.50),
    ("success/page", "success", "background", 4.50),
    ("warning/page", "warning", "background", 4.50),
    ("info/page", "info", "background", 4.50),
    ("destructive/page", "destructive", "background", 4.50),
    # `accent` is a hover wash on a raised surface, so the card is the ground it
    # is actually read against — asserting it against the page would be asserting
    # a pairing that never renders.
    ("accent/card", "accent", "card", 1.08),
]


def check(key, built):
    failures, report = [], {}
    for mode in ("light", "dark"):
        s, r = built[mode], {}
        for label, a, b, floor in GATES_BOTH:
            r[label] = ratio(s, a, b)
            if r[label] < floor:
                failures.append(f"{key}/{mode}: {label} = {r[label]:.2f} < {floor}")
        if mode == "light":
            for label, a, b, floor in (("border/card", "border", "card", 1.20),
                                       ("border/page", "border", "background", 1.15)):
                r[label] = ratio(s, a, b)
                if r[label] < floor:
                    failures.append(f"{key}/{mode}: {label} = {r[label]:.2f} < {floor}")

        ink = oklch_to_srgb(*s["pressed"][:3])
        on_card = over(ink, s["pressed"][3], oklch_to_srgb(*s["card"][:3]))
        r["pressed/card"] = contrast(on_card, oklch_to_srgb(*s["card"][:3]))
        r["pressed/page"] = contrast(on_card, oklch_to_srgb(*s["background"][:3]))
        on_control = over(ink, s["pressed"][3], oklch_to_srgb(*s["secondary"][:3]))
        r["pressed/control"] = contrast(on_control, oklch_to_srgb(*s["secondary"][:3]))
        for label, floor in (("pressed/card", 1.15), ("pressed/page", 1.10),
                             ("pressed/control", 1.15)):
            if r[label] < floor:
                failures.append(f"{key}/{mode}: {label} = {r[label]:.2f} < {floor}")

        if r["muted-fg/page"] >= r["fg/page"] * 0.65:
            failures.append(f"{key}/{mode}: muted-fg does not recede from running text")
        report[mode] = r

    lo, hi = report["light"]["muted-fg/page"], report["dark"]["muted-fg/page"]
    if abs(lo - hi) / max(lo, hi) >= 0.20:
        failures.append(f"{key}: muted-fg parity {lo:.2f} vs {hi:.2f}")
    return report, failures


if __name__ == "__main__":
    shown = ["fg/page", "muted-fg/page", "card/page", "muted/card", "control/page",
             "control-edge/page", "control-edge/control", "selected/control",
             "on-primary/primary", "brand/page", "pressed/control", "warning/page"]
    everything, all_failures = {}, []

    for key, spec in VARIANTS.items():
        built = build(spec)
        report, failures = check(key, built)
        all_failures += failures
        everything[key] = {
            "name": spec["name"], "tagline": spec["tagline"],
            "control": spec["control"], "shadow": spec["shadow"],
            "type": spec["type"], "brand_role": spec["brand_role"],
            "light": {n: (hex_of(*v[:3]) if len(v) == 3
                          else f"rgb(0 0 0 / {v[3]*100:.0f}%)") for n, v in built["light"].items()},
            "dark": {n: (hex_of(*v[:3]) if len(v) == 3
                         else f"rgb(255 255 255 / {v[3]*100:.0f}%)") for n, v in built["dark"].items()},
            "light_oklch": {n: (f"oklch({v[0]:.4g} {v[1]:.4g} {v[2]:.4g})" if len(v) == 3
                                else f"oklch(0 0 0 / {v[3]*100:.0f}%)") for n, v in built["light"].items()},
            "dark_oklch": {n: (f"oklch({v[0]:.4g} {v[1]:.4g} {v[2]:.4g})" if len(v) == 3
                               else f"oklch(1 0 0 / {v[3]*100:.0f}%)") for n, v in built["dark"].items()},
            "ratios": {m: {k: round(x, 2) for k, x in report[m].items()} for m in report},
        }
        print(f"\n=== {spec['name']} — {spec['tagline']} ===")
        print(f"{'gate':22} {'light':>7} {'dark':>7}")
        for k in shown:
            print(f"{k:22} {report['light'][k]:7.2f} {report['dark'][k]:7.2f}")

    print("\n=== FAILURES ===")
    print("\n".join(all_failures) if all_failures else
          "none — all four variants clear every gate, old and new")

    with open("variants.json", "w") as handle:
        json.dump(everything, handle, indent=2)
    print("\nwrote variants.json")
