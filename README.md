# NintendoGame.Watch

A fan tribute to the Nintendo Game & Watch — every model, every series,
across 1980 – 1991, plus the 2010 reissue and the 2020 – 2021 TFT-LCD
anniversary units.

Live site: <https://nintendogame.watch>

## What's in this repo

This is a static site served by GitHub Pages. No build step is needed —
just open `index.html` over HTTPS.

```
.
├── index.html              # the application (single-page)
├── 404.html                # branded 404 with the Parachute spirit
├── images_b64.json         # all device photos, manuals, hero shots,
│                           # and 3-D box-art baked into one fetch
├── FavIcon/                # favicons + PWA manifest
├── frame/                  # Game & Watch device-frame tile set
└── images/                 # standalone inline images:
                            #   logo, mascots, spirit cards,
                            #   404 parachute
```

The collection-tracker side is backed by Supabase — vault codes, file
uploads, share tokens, backup/restore. None of that requires anything
on this host beyond the static files.

## Hosting

GitHub Pages serves the repo root. The domain `nintendogame.watch`
points at the Pages CNAME via a DNS A/CNAME record set at the registrar.

## License / Acknowledgements

This is an independent, unofficial fan tribute. Not affiliated with,
endorsed by, or sponsored by Nintendo Co., Ltd. "Game & Watch", Nintendo,
and all related names and logos are trademarks of their respective
owners. No commerce, no claim to ownership — just documentation and
appreciation.

Manual scans courtesy of <https://www.gameandwatch.ch> (tricotronic
collection) and the Internet Archive. Spirit-card art from the Smash
Bros. Ultimate community wiki.
