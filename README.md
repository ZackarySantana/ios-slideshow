# Album Slideshow

Play any public iCloud Shared Album full screen as a slideshow in any browser. Dark mode only.

## Run locally

```sh
npm start            # http://localhost:3000  (Node 18+, no dependencies)
```

## Deploy (Vercel)

```sh
npx vercel           # static files come from public/, the proxy is api/album.js
```

The proxy has no dependencies and stores nothing. Any Node host works too: run `node server.js`.

## How it works

- `public/`: the whole client (plain HTML/CSS/JS, no build). The QR code is generated
  client-side with `vendor/qrcode.js` (qrcode-generator, MIT).
- `api/album.js`: `GET /api/album?token=…` returns `[{ id, url, thumb, sum }]` in the order photos were added
  (`sum` is the full-size file's checksum, used to spot byte-identical copies).
  It also sends the album name in an `X-Album-Title` header. Errors return `{ error, message }`
  with status 400 (bad token), 404 (missing or not public), or 502 (iCloud failure).
- `lib/icloud.js`: talks to Apple's unofficial shared-streams API: `webstream`
  (following 330 redirects via `X-Apple-MMe-Host`), then `webasseturls` in batches of 100.
  It skips videos, picks the largest image derivative, and returns signed URLs that expire
  after a few hours. The client re-fetches them on every refresh, and also when an image fails to load.

## URL parameters

| param | values | default |
|---|---|---|
| `album` | album token (the part after `#`) | — |
| `sec` | 2–600 | 7 |
| `shuffle`, `loop`, `dupes`, `qr` | `1` / `0` | 1 |
| `tr` | `fade` / `none` | fade |
| `fit` | `contain` / `cover` | contain |
| `refresh` | minutes: `0`, `2`, `5`, `15` | 5 |
| `qrpos` | `tl` `tr` `bl` `br` | br |
| `qrsize` | `s` / `m` | s |
| `qrurl` | any URL (omitted = album link) | album link |
| `qrcap` | caption text (omitted = automatic) | "View the album", or "Add your photos" with a custom `qrurl` |

A URL with `album` opens straight to **Tap to start**. The tap is needed for full screen and the wake lock.

## Player

- Keys: ←/→ previous/next · Space pause · R refresh · G gallery · S settings · F full screen
- Touch: tap to show or hide the controls, swipe for next/previous
- Gallery (grid button or G): the current loop as a scrolling grid of square thumbnails,
  2 per row on phones up to 10 on desktop. Played photos are dimmed, the current one is
  highlighted, and tapping a photo jumps to it. Thumbnails use iCloud's small (~340px) versions.
- Status note (bottom corner, shown on hover or tap): the last refresh on line 1
  ("Updated 3:42 PM · +4 new"), your place on line 2 ("Photo 12 of 137 · Loop 3";
  the loop count is left out when Loop is off)
- Refresh merges without interrupting the photo on screen. With shuffle on, new photos
  play next; with shuffle off, they're added at the end. Deleted photos are dropped.
- Settings (gear or S): Album, Playback and QR code cards. While playing, the album link is
  read-only with a Copy button; "Exit to setup" changes albums.

## Duplicate photos

With `dupes=1` (the default), duplicates are skipped silently; only the first-added copy plays.
Settings shows how many were found, with a preview of each group (tap one to compare).

- Byte-identical copies (same `sum`) are caught as soon as the album loads.
- Everything else is compared by picture, in the browser, after the first photo is on screen:
  each thumbnail gets a pHash (32×32 DCT) and a dHash (9×8), and two photos match when
  pHash ≤ 6 bits and dHash ≤ 8 bits apart with aspect ratios within 2%. Near-blank images
  only match by checksum. This catches re-uploads, re-saves, resizes and colour edits;
  crops and screenshots of a photo aren't caught, and near-still burst shots may be grouped.
- iCloud's image CDN sends CORS headers, which is what lets the browser read thumbnail pixels.
  Cost: about 40 KB per photo, once per session (roughly 6 MB and 5–8 s for 150 photos).
  Refreshes only check new photos, before they're queued.
- With the setting off, nothing is checked until Settings is opened.

## Notes

- The album owner must turn on **Public Website** (Photos → shared album → People icon).
- The public link is view-only: nobody can upload from it. Adding photos needs an invite to
  the shared album (Apple ID) with Subscribers Can Post on, so the QR link can point at a
  sign-up form instead.
- iPhone Safari doesn't support the Fullscreen API for web pages. Use Share → **Add to
  Home Screen** to run it chrome-less. iPad and desktop browsers go full screen normally.
