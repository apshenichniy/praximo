# Praximo coach-bot artwork

This directory is the repository-owned source for the approved Praximo
coach-bot mark. The two theme directories carry the same composition with
contrast treatments designed for their respective backgrounds.

## Files

Each `dark/` and `light/` directory contains:

- `avatar-512.png` — the 512×512 master avatar.
- `favicon-16.png`, `favicon-32.png`, `favicon-48.png` — browser PNG favicons.
- `favicon.ico` — a multi-resolution ICO containing 16×16, 32×32, and 48×48.
- `apple-touch-icon-180.png` — the Apple touch icon.
- `icon-192.png`, `icon-512.png` — web-app manifest icons.

Each theme directory also contains:

- `avatar.svg` — the resolution-independent vector version with its theme background.
- `avatar-transparent.svg` — the mark for placement over a matching themed surface.

The transparent variants omit the background entirely. Their figure color is
adapted for contrast, and only the guiding point remains pure white. Every SVG
uses native paths and gradients and does not embed a PNG.

Treat `avatar-512.png` as the source for its theme. Regenerate the smaller
artifacts from the master instead of editing them independently.

## Coach-bot default

The dark master is the platform default installed on newly provisioned coach
bots. Upload it to a stage without changing application code:

```sh
bun run branding:avatar:set --stage dev_apshenichniy \
  --file ./assets/branding/coach-bot/dark/avatar-512.png \
  --key branding/default-coach-avatar.jpg
```

Use the light set on pale UI surfaces and select the matching favicon set for
the page theme.
