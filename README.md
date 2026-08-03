# NintendoGame.Watch — standalone site

[![Code licence: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/code-PolyForm--NC--1.0.0-blue)](licenses/LICENSE)
[![Original assets: CC BY-NC-SA 4.0](https://img.shields.io/badge/assets-CC--BY--NC--SA--4.0-lightgrey)](licenses/LICENSE-ASSETS)
[![Third-party imagery: no licence granted](https://img.shields.io/badge/imagery-no%20licence%20granted-important)](licenses/NOTICE)

A self-contained copy of **NintendoGame.Watch**, a fan-tribute archive of
Nintendo's Game & Watch handhelds (1980–1991): all 59 devices, playable
emulators, manuals, a series timeline, and a personal collection tracker.

Everything needed to serve the site is in this folder. The only external piece
is the optional Supabase backend (personal collection, notes, prices, sharing,
recovery) — and that is fully documented and reproducible from
[`Database/`](./Database) so it can be rebuilt from scratch.

---

## Quick start (run it locally)

The site must be served over **HTTP** (not opened as a `file://` path — the
image archive and emulators won't load otherwise). A tiny PowerShell server is
included.

1. Open a PowerShell prompt in this folder.
2. Run:
   ```powershell
   .\server.ps1
   ```
3. Open <http://localhost:8080/>.

`server.ps1` is a minimal static file server (Windows PowerShell `HttpListener`,
no dependencies). It serves this folder on port **8080** and sends
cross-origin-isolation headers (`Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Embedder-Policy: require-corp`) plus `Cache-Control: no-store`, so
the WebAssembly/SharedArrayBuffer paths in the emulators work. Stop it with
`Ctrl + C`. To change the port, edit `$Port` at the top of `server.ps1`.

> **Browsing and all the emulators work with no backend at all.** Supabase only
> powers the *cloud* side of the collection (cross-device sync, notes/prices you
> type, uploaded photos/receipts, sharing, email recovery, market prices, and the
> Source Code tab). Without it, the site still loads, emulates, and remembers
> collected devices in the browser's local storage.

---

## Hosting it for real

It's a fully static site — any static host works (Netlify, Cloudflare Pages,
GitHub Pages, S3, nginx, …). Two things to know:

- **Serve over HTTPS/HTTP, never `file://`.**
- For the emulator/twin to use SharedArrayBuffer it needs **cross-origin
  isolation** — send `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (that's what `server.ps1` does).
  On hosts that don't let you set headers (e.g. GitHub Pages) the site still runs
  with graceful fallbacks; you just don't get the isolated fast path.
- GitHub Pages with a custom domain needs a `CNAME` file (one line: your domain).
  This standalone copy doesn't include one — add it if you go that route.

---

## Connecting the backend (optional)

To enable the cloud collection features, point the site at a Supabase project and
rebuild its database:

1. Follow **[`Database/README.md`](./Database/README.md)** to apply
   `Database/rebuild.sql` to a new Supabase project, create the `vault-files`
   storage bucket, and (optionally) deploy the two edge functions.
2. In `index.html`, set the two constants near the bottom (around line 17725 —
   search for `const SUPABASE_URL`):
   ```js
   const SUPABASE_URL      = 'https://<your-ref>.supabase.co';
   const SUPABASE_ANON_KEY = '<your anon key>';
   ```
3. Reload. A fresh vault mints on first load; the collection now syncs to your
   database.

See [`Database/FUNCTIONS.md`](./Database/FUNCTIONS.md) for the full backend map
(tables, every RPC "API" function, the edge functions, the security model).

---

## What the main files are

| Path | What it is |
|---|---|
| `index.html` | The entire single-page app — all HTML, CSS and JS inline. Home, Series, Collection, About, Settings, the device drawer, and the TFT twin play window all live here. This is where you set the Supabase URL/key and where most UI logic is. |
| `gnw.js` | The Game & Watch emulator for the 59 segmented-LCD devices — hand-written SM5A / SM510 / SM511 / SM512 CPU interpreters plus save-states. Drives the playable devices in the drawer. The device ROMs are **not** embedded here — they're fetched once on startup from `firmware/gnw_roms.json` and injected before any device boots. |
| `firmware/` | External ROM/firmware store. `gnw_roms.json` holds every segmented device's mask-ROM (and melody ROM) as base64, keyed by device — loaded by `gnw.js` on startup. `build_gnw_roms.ps1` rebuilds that JSON from a folder of original firmware dumps (edit `$SourceFolder` at the top, then Run in the PowerShell ISE — it finds and identifies the dumps by content hash, incl. inside .zip/.7z/.rar). (The two TFT twin firmwares still live under `play/`.) |
| `manual_booklet.js` | The 3D page-flip manual/booklet viewer used in each device drawer. |
| `images_b64.json`, `images_b64_2.json` | The bundled image archive: every device photo, box art, manual page and icon, base64-encoded. The site renders images from these as inline `data:` URIs — so all device imagery is local, no external image host. |
| `play/` | The **TFT twin** — a hand-written ARM (STM32H7B0) digital twin that boots the real Mario/Zelda "Game & Watch" firmware. `play/twin.js` + `play/<unit>/firmware_*.js` + device art. Powers the live clock on the Mario/Zelda tiles, the drawer preview, and their play window. |
| `gnw_*/` (59 folders) | Per-device art for the segmented emulator: `Background.png`, `Unit.png`, button overlays, etc. One folder per device. |
| `frame/` | The big Game & Watch bezel/shell tile images that frame the on-screen content. |
| `booklets/` | Manual/booklet page assets for the 3D viewer. |
| `images/` | Site chrome — the Game & Watch logo, Mr. Game & Watch and the "spirit" mascots, and other UI art. |
| `FavIcon/` | Favicons / app icons. |
| `404.html` | Not-found page (used by static hosts / GitHub Pages). |
| `server.ps1` | The local dev server described in Quick start. |
| `Database/` | Archival backup of the Supabase backend + how to rebuild it (see its README). |

Total size ≈ 530 MB (the bulk is the base64 image archive, the manual pages.

---

## Loading the content pack from Google Drive (optional)

On a hosted copy (e.g. GitHub Pages) the "Batteries not included" banner can
offer a **From cloud storage → Google Drive** button, so a visitor signs in and
picks the content `.zip` from their own Drive instead of choosing a local file.
It uses the narrow `drive.file` scope — the site only ever sees the single file
the user picks. It's **off until you add two public values** (an OAuth Client ID
and an API key — safe to commit; these are *not* secrets) to the `CONFIG.google`
block at the top of [`firmware/cloud_storage.js`](./firmware/cloud_storage.js).
It is hidden on `localhost` by design (the local server's isolation headers block
Google's sign-in popup, and locally you can just copy the files down yourself).

One-time setup in the [Google Cloud Console](https://console.cloud.google.com):

1. **New project** — top-bar project dropdown → *New Project*.
2. **Enable APIs** — *APIs & Services → Library* → enable **Google Picker API**
   and **Google Drive API**.
3. **OAuth consent screen** — *APIs & Services → OAuth consent screen* →
   **External** → fill in an app name + your email. Add yourself as a *Test user*,
   then **Publish** the app so any visitor can use it. (`drive.file` is
   non-sensitive, so no Google verification review is required.)
4. **OAuth Client ID** — *Credentials → Create Credentials → OAuth client ID →
   Web application*. Under *Authorised JavaScript origins* add your site origin,
   e.g. `https://<you>.github.io`. Create, then copy the **Client ID**.
5. **API key** — *Credentials → Create Credentials → API key*; copy it. Optional
   but recommended: edit it → restrict *Application* to your website origin and
   *API* to Picker + Drive.
6. **Paste both** into `firmware/cloud_storage.js`:
   ```js
   google: { clientId: '…apps.googleusercontent.com', apiKey: 'AIza…', appId: '' }
   ```
   `appId` is optional (your project **number**, from the project's *Settings*).
7. Reload the hosted site — the banner now shows **Google Drive**. Signing in and
   picking the `.zip` imports it into the browser exactly like a local pack.

---

## Notes

- This is a fan project — not affiliated with, endorsed by, or sponsored by
  Nintendo. "Game & Watch" and related names are trademarks of their respective
  owners.
- The `Database/rebuild.sql` seed data and `device_prices` are public/reference
  data only. No private user vault data (people's notes, prices, photos) is
  included in this backup, by design.
