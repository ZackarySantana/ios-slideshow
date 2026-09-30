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
- `api/album.js`: `GET /api/album?token=…` returns `[{ id, url }]` in the order photos were added.
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
| `shuffle`, `loop`, `qr` | `1` / `0` | 1 |
| `tr` | `fade` / `none` | fade |
| `fit` | `contain` / `cover` | contain |
| `refresh` | minutes: `0`, `2`, `5`, `15` | 5 |
| `qrpos` | `tl` `tr` `bl` `br` | br |
| `qrsize` | `s` / `m` | s |
| `qrurl` | any URL (omitted = album link) | album link |
| `qrcap` | caption text | Add your photos |

A URL with `album` opens straight to **Tap to start**. The tap is needed for full screen and the wake lock.

## Player

- Keys: ←/→ previous/next · Space pause · R refresh · S settings · F full screen
- Touch: tap to show or hide the controls, swipe for next/previous
- Refresh merges without interrupting the photo on screen. With shuffle on, new photos
  play next; with shuffle off, they're added at the end. Deleted photos are dropped.

## Notes

- The album owner must turn on **Public Website** (Photos → shared album → People icon).
- The public link is view-only. Adding photos needs an invite to the shared album, so
  the QR target can be edited.
- iPhone Safari doesn't support the Fullscreen API for web pages. Use Share → **Add to
  Home Screen** to run it chrome-less. iPad and desktop browsers go full screen normally.
