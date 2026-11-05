/* Maps, geocoding (Nominatim) and routing (OSRM). */
(function () {
  const SG = (window.SG = window.SG || {});
  const cfg = window.SAKAYGO_CONFIG;
  const PH_VIEWBOX = "116.9,21.2,126.7,4.5"; // lon/lat box around the Philippines

  let lastGeocode = 0;
  async function politeFetch(url) {
    // Nominatim fair use: at most one request per second.
    const wait = Math.max(0, lastGeocode + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastGeocode = Date.now();
    const res = await fetch(url, { headers: { "Accept-Language": "en" } });
    if (!res.ok) throw new Error(`Map service returned ${res.status}`);
    return res.json();
  }

  const maps = {
    async search(q) {
      if (!q || q.trim().length < 3) return [];
      const url = `${cfg.nominatimUrl}/search?format=jsonv2&limit=6&countrycodes=ph&viewbox=${PH_VIEWBOX}&q=${encodeURIComponent(q)}`;
      const rows = await politeFetch(url);
      return rows.map((r) => ({
        name: r.display_name,
        short: r.name || r.display_name.split(",")[0],
        lat: +r.lat,
        lon: +r.lon,
      }));
    },

    async reverse(lat, lon) {
      const url = `${cfg.nominatimUrl}/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lon}`;
      const r = await politeFetch(url);
      return { name: r.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`, short: (r.name || r.display_name || "My location").split(",")[0], lat, lon };
    },

    currentPosition() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error("Location isn't supported on this device."));
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
          (e) => reject(new Error(e.code === 1 ? "Location permission was denied. Allow it in your browser settings, or type a starting point." : "Couldn't get your location. Try again or type a starting point.")),
          { enableHighAccuracy: true, timeout: 12000 }
        );
      });
    },

    /** Driving routes with alternatives and turn-by-turn steps. */
    async route(from, to) {
      const url = `${cfg.osrmUrl}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=true&alternatives=3`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.code !== "Ok") throw new Error(json.message || "No driving route found between these places.");
      return json.routes.map((r, i) => ({
        index: i,
        km: r.distance / 1000,
        minutes: r.duration / 60,
        coords: r.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
        via: summarize(r),
        steps: r.legs.flatMap((l) => l.steps).map((s) => ({ text: stepText(s), km: s.distance / 1000 })),
      }));
    },

    makeMap(el, opts = {}) {
      const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(opts.center || [14.5995, 120.9842], opts.zoom || 11);
      L.tileLayer(cfg.tileUrl, { maxZoom: 19, attribution: cfg.tileAttribution }).addTo(map);
      return map;
    },
  };

  function summarize(r) {
    const names = r.legs.flatMap((l) => l.steps).filter((s) => s.name && s.distance > 800).sort((a, b) => b.distance - a.distance).slice(0, 2).map((s) => s.name);
    return names.length ? "via " + [...new Set(names)].join(" and ") : "";
  }

  function stepText(s) {
    const t = s.maneuver.type;
    const mod = s.maneuver.modifier || "";
    const road = s.name ? ` onto ${s.name}` : "";
    const on = s.name ? ` on ${s.name}` : "";
    switch (t) {
      case "depart": return `Head ${dir(s.maneuver.bearing_after)}${on}`;
      case "arrive": return "Arrive at your destination";
      case "turn": return `Turn ${mod}${road}`;
      case "new name": return `Continue${road}`;
      case "continue": return `Continue ${mod}${on}`.replace("  ", " ");
      case "merge": return `Merge ${mod}${road}`;
      case "on ramp": return `Take the ramp ${mod}${road}`;
      case "off ramp": return `Take the exit ${mod}${road}`;
      case "fork": return `Keep ${mod} at the fork${road}`;
      case "end of road": return `At the end of the road, turn ${mod}${road}`;
      case "roundabout":
      case "rotary": return `At the roundabout, take exit ${s.maneuver.exit || 1}${road}`;
      case "exit roundabout":
      case "exit rotary": return `Exit the roundabout${road}`;
      case "use lane": return `Use the ${mod} lane${on}`;
      default: return `${t} ${mod}${road}`.trim();
    }
  }
  function dir(b) {
    return ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][Math.round((b || 0) / 45) % 8];
  }

  SG.maps = maps;
})();
