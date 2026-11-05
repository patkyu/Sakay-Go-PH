# SakayGo

A website for Filipino commuters: fare calculator, trip planner, community routes, alerts, reviews, points and an admin review queue.

It's plain HTML, CSS and JavaScript with no build step, so you can host it on Netlify, Vercel, GitHub Pages, Cloudflare Pages or any static host.

## Run it locally

```bash
cd sakaygo
python3 -m http.server 8080
```

Then open http://localhost:8080. Serve it over http(s). Opening `index.html` from disk blocks location access and the network calls.

The site starts in **demo mode**. Accounts, routes, reviews and alerts are stored in the browser's localStorage, and the demo data comes pre-loaded.
- Demo admin login: `admin@sakaygo.demo` / `admin1234`
- Sample commuters: `ana@sakaygo.demo`, `jun@sakaygo.demo`, `mae@sakaygo.demo` / `commuter123`

## What it connects to

| Feature | Service | Where to change it |
|---|---|---|
| Map tiles | OpenStreetMap | `tileUrl` in `js/config.js` |
| Place search and reverse geocoding | Nominatim | `nominatimUrl` |
| Driving routes and turn-by-turn directions | OSRM | `osrmUrl` |
| Fare matrices | Bundled `js/fare-matrices.js`, or your own JSON API | `fareMatrixUrl` |
| Accounts and community data | localStorage (demo) or Supabase | `backend`, `supabaseUrl`, `supabaseAnonKey` |

The public Nominatim and OSRM servers have fair-use limits. Before launch, switch to a paid or self-hosted provider such as MapTiler, Stadia, LocationIQ, GraphHopper or your own OSRM. Only the URLs in `config.js` need to change.

### Fare matrix API

LTFRB doesn't offer an official fare API, so SakayGo reads fares from a JSON document. If `fareMatrixUrl` is set, the app fetches it on start-up. If the request fails, it falls back to the bundled file. The JSON has the same shape as `window.SG_FARE_DATA` in `js/fare-matrices.js`:

```json
{
  "version": "2026-11",
  "roundTo": 0.25,
  "discounts": { "none": {"label":"Regular","pct":0}, "student": {"label":"Student","pct":20}, "senior": {"label":"Senior citizen / PWD","pct":20} },
  "modes": { "puj_traditional": {"label":"Traditional jeepney","base":13,"baseKm":4,"perKm":1.8,"source":"LTFRB MC ..."} },
  "tricycle": { "label":"Tricycle", "sample": false, "cities": { "quezon_city": {"name":"Quezon City","base":15,"baseKm":1,"perKm":5,"specialMultiplier":4} } }
}
```

Fare formula: `base + ceil(km − baseKm) × perKm`, rounded to the nearest ₱0.25. Discounts are taken off the regular fare and rounded the same way.

**Before launch:** check every value against the latest LTFRB memorandum circulars. The tricycle figures are **sample placeholders**, and the site labels them that way. Replace them with each LGU's ordinance values and set `"sample": false`.

## Go live with Supabase

1. Create a Supabase project.
2. In the SQL editor, run `supabase/schema.sql`. It creates the tables, views, row-level security, point rules and account deletion.
3. In `js/config.js`, set `backend: "supabase"` and paste your project URL and anon key.
4. In Supabase → Authentication → URL Configuration, add your site URL to the redirect URLs. Password reset and email confirmation need this.
5. Make yourself an admin:
   ```sql
   update public.profiles set role = 'admin' where id = '<your user uuid>';
   ```

Points: when an admin verifies a route, its submitter gets 50 points. If the route is later disapproved, the points are removed. The amount is set in `config.js` and in the `set_route_status` SQL function.

## Files

```
index.html            app shell
css/styles.css        styles (light and dark)
js/config.js          settings: backend, API URLs, points
js/fare-matrices.js   bundled fare data
js/fares.js           fare engine and remote matrix loader
js/maps.js            Leaflet map, Nominatim, OSRM
js/store.js           data layer (LocalStore and SupabaseStore)
js/app.js             pages and router
supabase/schema.sql   database schema
vendor/leaflet/       Leaflet 1.9.4 (bundled)
```

## Pages

`#home`, `#fare`, `#planner`, `#routes`, `#route/<id>`, `#alerts`, `#submit`, `#saved`, `#profile`, `#leaderboard`, `#recent`, `#admin`, `#about`, `#contact`, `#login`, `#register`, `#forgot`, `#reset`
