/* SakayGo app: hash router + views. */
(function () {
  const SG = window.SG;
  const cfg = window.SAKAYGO_CONFIG;
  const store = SG.createStore();
  const fares = SG.fares;
  const maps = SG.maps;
  const app = document.getElementById("app");
  let me = null;
  let activeMap = null;
  let currentView = "";

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const peso = (n) => "₱" + Number(n || 0).toFixed(2);
  const fmtMin = (m) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);
  const fmtKm = (k) => (k < 10 ? k.toFixed(1) : Math.round(k)) + " km";
  function timeAgo(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    if (s < 86400 * 30) return Math.floor(s / 86400) + " d ago";
    return new Date(iso).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
  }
  function toast(msg, kind = "") {
    const t = document.createElement("div");
    t.className = "toast " + kind; t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  async function busy(btn, fn) {
    const label = btn.innerHTML; btn.disabled = true;
    try { return await fn(); } catch (e) { toast(e.message || String(e), "bad"); } finally { btn.disabled = false; btn.innerHTML = label; }
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function needLogin() {
    app.innerHTML = `<div class="auth-wrap card stack"><h2>Sign in to continue</h2><p class="muted">You need a SakayGo account for this. It's free and takes a minute.</p>
      <div class="row"><a class="btn" href="#login">Sign in</a><a class="btn ghost" href="#register">Create account</a></div></div>`;
  }

  /* ---------- icons ---------- */
  const ICON = {
    jeepney: '<path d="M3 15V9a2 2 0 0 1 2-2h11l4 4v4z"/><path d="M3 11h17M6 7V5h9v2"/><circle cx="7" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/>',
    modern_jeepney: '<rect x="3" y="5" width="18" height="11" rx="2"/><path d="M3 10h18M8 5v5M13 5v5"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
    bus: '<rect x="5" y="3" width="14" height="15" rx="2"/><path d="M5 11h14M5 7h14M7 18v2M17 18v2"/><circle cx="8.5" cy="14.5" r="1"/><circle cx="15.5" cy="14.5" r="1"/>',
    uv: '<path d="M2 15V8a2 2 0 0 1 2-2h10l5 4h1a2 2 0 0 1 2 2v3z"/><path d="M2 11h20M9 6v5"/><circle cx="6.5" cy="16.5" r="1.8"/><circle cx="17.5" cy="16.5" r="1.8"/>',
    tricycle: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l4-7h5l3 7M10 10V6h6v4"/>',
    walk: '<circle cx="13" cy="4" r="1.8"/><path d="M10 21l2-6 3 3v3M9 12l2-4 4 2 2 3M11 8l-2 5"/>',
    rail: '<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M8 16l-1 4M16 16l1 4M7 20h10"/>',
    ferry: '<path d="M3 15l2 4h14l2-4zM6 15V9h12v6M12 9V4"/>',
    other: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ICON.other}</svg>`;
  const STEP_MODES = { walk: "Walk", jeepney: "Jeepney", modern_jeepney: "Modern jeepney", bus: "Bus", uv: "UV Express", tricycle: "Tricycle", rail: "Train (LRT/MRT/PNR)", ferry: "Ferry", other: "Other" };
  const FARE_ICON = { puj_traditional: "jeepney", puj_modern: "modern_jeepney", puj_modern_ac: "modern_jeepney", bus_city: "bus", bus_city_ac: "bus", tricycle: "tricycle" };
  const ALERT_TYPES = { traffic: "Heavy traffic", roadblock: "Road block", no_vehicle: "No vehicles available", queue: "Long queue", other: "Other" };
  const LEVELS = [
    { name: "Bagong Sakay", min: 0 },
    { name: "Suki", min: 100 },
    { name: "Biyahero", min: 300 },
    { name: "Lakbay Expert", min: 700 },
    { name: "Alamat ng Kalsada", min: 1500 },
  ];
  function levelFor(points) {
    let i = 0; LEVELS.forEach((l, j) => { if (points >= l.min) i = j; });
    const cur = LEVELS[i], next = LEVELS[i + 1];
    return { cur, next, idx: i, pct: next ? ((points - cur.min) / (next.min - cur.min)) * 100 : 100 };
  }
  const stars = (n) => `<span class="stars" aria-label="${n.toFixed(1)} out of 5">${"★".repeat(Math.round(n))}<span style="color:var(--line)">${"★".repeat(5 - Math.round(n))}</span></span>`;
  function statusPill(s) {
    return s === "verified" ? '<span class="pill ok">Verified</span>' : s === "pending" ? '<span class="pill warn">Pending review</span>' : '<span class="pill bad">Flagged</span>';
  }

  /* ---------- recent calculations ---------- */
  const recent = {
    all: () => ls.get("sg_recent", []),
    add(item) { const list = recent.all(); list.unshift({ ...item, at: new Date().toISOString() }); ls.set("sg_recent", list.slice(0, 25)); },
    clear: () => ls.set("sg_recent", []),
  };

  /* ---------- place autocomplete ---------- */
  function placeInput(wrap, { id, placeholder, value }) {
    wrap.classList.add("place");
    wrap.innerHTML = `<input id="${id}" type="text" autocomplete="off" placeholder="${esc(placeholder)}" aria-autocomplete="list"><div class="place-list" hidden role="listbox"></div>`;
    const input = $("input", wrap), list = $(".place-list", wrap);
    let picked = null, timer = null, seq = 0;
    const api = {
      get: () => picked,
      set(p) { picked = p; input.value = p ? p.short + (p.name && p.name !== p.short ? ", " + p.name.split(",").slice(1, 3).join(",").trim() : "") : ""; api.close(); },
      close() { clearTimeout(timer); seq++; list.hidden = true; },
      input,
    };
    if (value) api.set(value);
    input.addEventListener("input", () => {
      picked = null; clearTimeout(timer);
      const q = input.value;
      if (q.trim().length < 3) { list.hidden = true; return; }
      timer = setTimeout(async () => {
        const my = ++seq;
        list.hidden = false; list.innerHTML = '<button type="button" disabled>Searching…</button>';
        try {
          const rows = await maps.search(q);
          if (my !== seq) return;
          list.innerHTML = rows.length ? rows.map((r, i) => `<button type="button" data-i="${i}" role="option"><b>${esc(r.short)}</b><span>${esc(r.name)}</span></button>`).join("") : '<button type="button" disabled>No places found in the Philippines. Try a landmark or barangay.</button>';
          $$("button[data-i]", list).forEach((b) => b.addEventListener("click", () => { api.set(rows[+b.dataset.i]); input.dispatchEvent(new CustomEvent("picked")); }));
        } catch (e) { list.innerHTML = `<button type="button" disabled>Search failed: ${esc(e.message)}</button>`; }
      }, 450);
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") list.hidden = true; if (e.key === "ArrowDown") { const b = $("button[data-i]", list); if (b) { e.preventDefault(); b.focus(); } } });
    list.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input so a click on a suggestion lands
    wrap.addEventListener("focusout", () => setTimeout(() => { if (!wrap.contains(document.activeElement)) api.close(); }, 150));
    return api;
  }

  async function resolvePlace(api) {
    if (api.get()) return api.get();
    const q = api.input.value.trim();
    if (!q) return null;
    const rows = await maps.search(q);
    if (!rows.length) throw new Error(`Couldn't find "${q}". Pick a suggestion from the list.`);
    api.set(rows[0]);
    return rows[0];
  }

  /* ---------- fare widgets ---------- */
  function fareTicket(r) {
    return `<div class="ticket">
      <div class="ticket-total"><div><div class="eyebrow">Estimated fare · ${esc(r.discountLabel)}</div><div class="muted small">${esc(r.label)} · ${r.km.toFixed(1)} km</div></div><div class="fare">${peso(r.total)}</div></div>
      <table class="lines"><tbody>${r.lines.map((l) => `<tr class="${l.strong ? "strong" : ""} ${l.amount < 0 ? "neg" : ""}"><td>${esc(l.label)}</td><td>${l.amount < 0 ? "−" + peso(-l.amount) : peso(l.amount)}</td></tr>`).join("")}
        <tr class="strong"><td>You pay</td><td>${peso(r.total)}</td></tr></tbody></table>
      <p class="small muted" style="margin-top:10px">Source: ${esc(r.source)}${r.discountLaw ? " · Discount under " + esc(r.discountLaw) + ". Show a valid ID." : ""}</p>
      ${r.sample ? '<p class="notice warn small" style="margin-top:8px">Tricycle fares on this site are sample values until the LGU ordinance figures are loaded. Confirm with the driver or the posted fare matrix.</p>' : ""}
    </div>`;
  }
  function estimatesGrid(km, discount = "none") {
    return `<div class="estimates">${fares.estimateAll(km, discount).map((e) => `<div>${esc(e.label)}<span class="fare">${peso(e.total)}</span></div>`).join("")}</div>`;
  }

  /* =================== VIEWS =================== */

  async function viewHome() {
    const [alerts, routes] = await Promise.all([store.listAlerts().catch(() => []), store.listRoutes().catch(() => [])]);
    app.innerHTML = `
      <div class="ptr" id="ptr">Pull to refresh</div>
      <div class="stack-lg">
        <section class="hero">
          <div>
            <div class="eyebrow" style="color:inherit;opacity:.75">Para sa bawat commuter</div>
            <h1>Know your fare <em>before</em> you ride.</h1>
            <p>Estimate jeepney, bus and tricycle fares with student and senior/PWD discounts, plan your trip on the map, and follow routes that other commuters have tested.</p>
          </div>
          <form class="quick stack" id="quick" aria-label="Quick fare check">
            <div class="grid-2" style="gap:10px">
              <label class="field">Ride<select id="qMode">${fares.modeList().filter((m) => m.id !== "tricycle").map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join("")}</select></label>
              <label class="field">Distance (km)<input id="qKm" type="number" min="0" step="0.1" value="8" inputmode="decimal"></label>
            </div>
            <div class="seg" role="radiogroup" aria-label="Discount">
              ${Object.entries(fares.data.discounts).map(([k, d], i) => `<input type="radio" name="qDisc" id="qd-${k}" value="${k}" ${i === 0 ? "checked" : ""}><label for="qd-${k}">${esc(d.label)}</label>`).join("")}
            </div>
            <div id="qOut"></div>
            <a class="small" href="#fare">Full calculator with breakdown and tricycle fares →</a>
          </form>
        </section>

        <section class="tiles">
          <a class="card tile" href="#fare">${icon("jeepney")}<b>Fare calculator</b><span>Jeepney, bus and tricycle fares with discounts</span></a>
          <a class="card tile" href="#planner"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14"/></svg><b>Trip planner</b><span>Map, distance, travel time and directions</span></a>
          <a class="card tile" href="#routes">${icon("walk")}<b>Community routes</b><span>Step-by-step routes from real commuters</span></a>
          <a class="card tile" href="#alerts"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg><b>Commuter alerts</b><span>Traffic, road blocks and long queues</span></a>
        </section>

        <div class="grid-2">
          <section>
            <div class="section-head"><h2>Live alerts</h2><a href="#alerts">All alerts</a></div>
            <div class="stack">${alerts.slice(0, 3).map(alertItem).join("") || '<div class="card empty"><b>No alerts in the last 48 hours</b>Roads look clear. Seen a problem? <a href="#alerts">Post an alert</a>.</div>'}</div>
          </section>
          <section>
            <div class="section-head"><h2>Top routes</h2><a href="#routes">Browse routes</a></div>
            <div class="stack">${routes.slice(0, 3).map(routeCard).join("") || '<div class="card empty"><b>No verified routes yet</b><a href="#submit">Submit the first one</a>.</div>'}</div>
          </section>
        </div>
      </div>`;
    const out = $("#qOut");
    const upd = () => {
      const r = fares.calc({ mode: $("#qMode").value, km: $("#qKm").value, discount: $('input[name="qDisc"]:checked').value });
      out.innerHTML = `<div class="ticket-total" style="margin:0;padding:0;border:0"><span class="muted small">${esc(r.discountLabel)} fare</span><span class="fare" style="font-size:2rem">${peso(r.total)}</span></div>`;
    };
    $("#quick").addEventListener("input", upd);
    $("#quick").addEventListener("submit", (e) => e.preventDefault());
    upd();
  }

  function alertItem(a) {
    return `<div class="card flat alert-item ${esc(a.type)}"><span class="bar"></span><div class="stack" style="gap:4px">
      <div class="row" style="justify-content:space-between"><b>${esc(ALERT_TYPES[a.type] || a.type)} · ${esc(a.location)}</b><span class="small muted">${timeAgo(a.created_at)}</span></div>
      ${a.message ? `<p>${esc(a.message)}</p>` : ""}
      <p class="small muted">Posted by ${esc(a.user_name)}${a.route_id ? ` · <a href="#route/${esc(a.route_id)}">View route</a>` : ""}</p></div></div>`;
  }

  function routeCard(r) {
    const modes = [...new Set(r.steps.map((s) => s.mode))].filter((m) => m !== "walk");
    return `<a class="card route-card" href="#route/${esc(r.id)}">
      <div class="row" style="justify-content:space-between;align-items:start;flex-wrap:nowrap"><h3>${esc(r.title)}</h3>${r.status !== "verified" ? statusPill(r.status) : ""}</div>
      <div class="od"><i></i><span>${esc(r.origin)}</span><i class="to"></i><span>${esc(r.destination)}</span></div>
      <div class="chips">${modes.map((m) => `<span class="pill">${esc(STEP_MODES[m] || m)}</span>`).join("")}${r.outdated >= 2 && r.outdated >= r.up ? '<span class="pill bad">Reported outdated</span>' : ""}</div>
      <div class="meta"><span>Fare <b>${peso(r.total_fare)}</b></span><span>About <b>${fmtMin(r.duration_min || 0)}</b></span><span>▲ <b>${r.up}</b></span>${r.review_count ? `<span>${stars(r.avg_rating)} ${r.review_count}</span>` : ""}</div>
    </a>`;
  }

  /* ---------- Fare calculator ---------- */
  async function viewFare() {
    const pre = ls.get("sg_fare_prefill", null); ls.set("sg_fare_prefill", null);
    const modes = fares.modeList();
    app.innerHTML = `
      <div class="page-head"><div><h1>Fare calculator</h1><p class="muted">Based on the LTFRB fare matrix for jeepneys and city buses, and city fare ordinances for tricycles. Matrix version <span class="mono">${esc(fares.data.version)}</span>.</p></div></div>
      <div class="split">
        <form class="card stack" id="fareForm">
          <fieldset style="border:0;padding:0;margin:0" class="stack"><legend class="eyebrow" style="margin-bottom:8px">Vehicle</legend>
            <div class="mode-grid">${modes.map((m, i) => `<input type="radio" name="mode" id="m-${m.id}" value="${m.id}" ${i === 0 ? "checked" : ""}><label for="m-${m.id}">${icon(FARE_ICON[m.id])}${esc(m.label)}</label>`).join("")}</div>
          </fieldset>
          <div id="trikeOpts" class="grid-2" hidden>
            <label class="field">City<select id="city">${fares.cityList().map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
            <label class="field" style="flex-direction:row;align-items:center;gap:8px;margin-top:24px"><input type="checkbox" id="special" style="width:auto"> Special trip (whole tricycle)</label>
          </div>
          <label class="field">Distance in kilometers<input id="km" type="number" min="0" step="0.1" value="6" inputmode="decimal" required><span class="hint">Don't know the distance? Measure it below.</span></label>
          <details id="measure"><summary style="cursor:pointer;font-weight:600">Measure distance between two places</summary>
            <div class="stack" style="margin-top:10px"><div id="mFrom"></div><div id="mTo"></div>
              <button class="btn ghost" type="button" id="measureBtn">Measure road distance</button><p class="small muted" id="measureOut"></p></div>
          </details>
          <fieldset style="border:0;padding:0;margin:0"><legend class="eyebrow" style="margin-bottom:8px">Passenger type</legend>
            <div class="seg">${Object.entries(fares.data.discounts).map(([k, d], i) => `<input type="radio" name="disc" id="d-${k}" value="${k}" ${i === 0 ? "checked" : ""}><label for="d-${k}">${esc(d.label)}</label>`).join("")}</div>
          </fieldset>
          <button class="btn sign" type="submit">Calculate fare</button>
        </form>
        <div class="stack"><div id="fareOut"></div>
          <div class="card flat stack"><h3>Same distance, other rides</h3><div id="others"></div></div>
        </div>
      </div>`;
    const form = $("#fareForm");
    const mFrom = placeInput($("#mFrom"), { id: "mFromIn", placeholder: "From (e.g. SM North EDSA)" });
    const mTo = placeInput($("#mTo"), { id: "mToIn", placeholder: "To (e.g. Quiapo Church)" });
    let measured = null;
    if (pre) {
      $("#m-" + pre.mode) && ($("#m-" + pre.mode).checked = true);
      $("#km").value = pre.km;
      if (pre.city) $("#city").value = pre.city;
      $("#special").checked = !!pre.special;
      $("#d-" + (pre.discount || "none")).checked = true;
      if (pre.from && pre.to) { mFrom.set(pre.from); mTo.set(pre.to); measured = { from: pre.from, to: pre.to }; }
    }
    const read = () => ({ mode: $('input[name="mode"]:checked', form).value, km: parseFloat($("#km").value) || 0, discount: $('input[name="disc"]:checked', form).value, city: $("#city").value, special: $("#special").checked });
    const upd = () => {
      const p = read();
      $("#trikeOpts").hidden = p.mode !== "tricycle";
      const r = fares.calc(p);
      $("#fareOut").innerHTML = fareTicket(r);
      $("#others").innerHTML = estimatesGrid(p.km, p.discount);
      return r;
    };
    form.addEventListener("input", upd);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const p = read(); const r = upd();
      recent.add({ kind: "fare", ...p, label: r.label, total: r.total, discountLabel: r.discountLabel, from: measured?.from || null, to: measured?.to || null });
      toast("Saved to recent calculations");
    });
    $("#measureBtn").addEventListener("click", (e) => busy(e.currentTarget, async () => {
      e.currentTarget.textContent = "Measuring…";
      const a = await resolvePlace(mFrom), b = await resolvePlace(mTo);
      if (!a || !b) throw new Error("Enter both places to measure the distance.");
      const [best] = await maps.route(a, b);
      $("#km").value = best.km.toFixed(1);
      measured = { from: a, to: b };
      $("#measureOut").textContent = `Road distance ${fmtKm(best.km)}, about ${fmtMin(best.minutes)} by car without stops. Fare uses this distance.`;
      upd();
    }));
    if (pre && pre.from) $("#measure").open = true;
    upd();
  }

  /* ---------- Trip planner ---------- */
  const planner = { from: null, to: null, results: null, sel: 0 };
  async function viewPlanner() {
    const pre = ls.get("sg_trip_prefill", null); ls.set("sg_trip_prefill", null);
    if (pre) { planner.from = pre.from; planner.to = pre.to; planner.results = null; }
    app.innerHTML = `
      <div class="page-head"><div><h1>Trip planner</h1><p class="muted">Find road routes between places in the Philippines with distance, travel time and turn-by-turn directions.</p></div></div>
      <p class="notice warn" style="margin-bottom:16px">These are driving routes. Jeepneys and buses may take different roads, so the fares shown are estimates for the road distance. Check <a href="#routes">community routes</a> for public-transport steps.</p>
      <div class="split">
        <div class="stack">
          <form class="card stack" id="planForm">
            <label class="field" for="pFromIn">Starting point</label>
            <div class="place-row"><div id="pFrom"></div><button class="btn ghost" type="button" id="locBtn" title="Use my current location">📍 Me</button></div>
            <label class="field" for="pToIn">Destination</label>
            <div id="pTo"></div>
            <div class="row"><button class="btn sign" type="submit" style="flex:1">Find routes</button><button class="btn ghost" type="button" id="swapBtn" aria-label="Swap start and destination">⇅ Swap</button></div>
          </form>
          <div id="options" class="stack"></div>
        </div>
        <div class="stack">
          <div class="map" id="map"></div>
          <div id="detail" class="stack"></div>
        </div>
      </div>`;
    const from = placeInput($("#pFrom"), { id: "pFromIn", placeholder: "Search a place or landmark", value: planner.from });
    const to = placeInput($("#pTo"), { id: "pToIn", placeholder: "Where are you going?", value: planner.to });
    activeMap = maps.makeMap($("#map"));
    const layer = L.layerGroup().addTo(activeMap);

    function draw() {
      layer.clearLayers();
      const res = planner.results;
      if (planner.from) L.circleMarker([planner.from.lat, planner.from.lon], { radius: 8, color: "#12355b", fillColor: "#fff", fillOpacity: 1, weight: 3 }).bindTooltip("Start").addTo(layer);
      if (planner.to) L.circleMarker([planner.to.lat, planner.to.lon], { radius: 8, color: "#12355b", fillColor: "#12355b", fillOpacity: 1, weight: 3 }).bindTooltip("Destination").addTo(layer);
      if (!res) {
        const pts = [planner.from, planner.to].filter(Boolean);
        if (pts.length === 1) activeMap.setView([pts[0].lat, pts[0].lon], 14);
        $("#options").innerHTML = ""; $("#detail").innerHTML = "";
        return;
      }
      res.forEach((r, i) => { if (i !== planner.sel) L.polyline(r.coords, { color: "#7d8ea3", weight: 5, opacity: .7 }).on("click", () => { planner.sel = i; draw(); }).addTo(layer); });
      const sel = res[planner.sel];
      const line = L.polyline(sel.coords, { color: "#f3b81e", weight: 7 }).addTo(layer);
      L.polyline(sel.coords, { color: "#12355b", weight: 3 }).addTo(layer);
      activeMap.fitBounds(line.getBounds(), { padding: [30, 30] });

      $("#options").innerHTML = `<h3>${res.length} route option${res.length > 1 ? "s" : ""}</h3>` + res.map((r, i) => `
        <button type="button" class="card option ${i === planner.sel ? "sel" : ""}" data-i="${i}">
          <span><b>Option ${i + 1}</b>${i === 0 ? ' <span class="pill ok">Fastest</span>' : ""}<br><span class="small muted">${esc(r.via) || "Main roads"}</span></span>
          <span style="text-align:right"><span class="big">${fmtMin(r.minutes)}</span><br><span class="small muted mono">${fmtKm(r.km)}</span></span>
        </button>`).join("");
      $$("#options .option").forEach((b) => b.addEventListener("click", () => { planner.sel = +b.dataset.i; draw(); }));

      $("#detail").innerHTML = `
        <div class="card stack"><div class="row" style="justify-content:space-between"><h3>Fare estimates for ${fmtKm(sel.km)}</h3>
          <button class="btn ghost small" id="toFare" type="button">Open in fare calculator</button></div>${estimatesGrid(sel.km)}</div>
        <div class="card stack"><h3>Turn-by-turn directions</h3><ol class="turns">${sel.steps.map((s) => `<li><span>${esc(s.text)}</span><span class="km">${s.km >= 0.05 ? fmtKm(s.km) : ""}</span></li>`).join("")}</ol></div>`;
      $("#toFare").addEventListener("click", () => { ls.set("sg_fare_prefill", { mode: "puj_traditional", km: sel.km.toFixed(1), discount: "none", from: planner.from, to: planner.to }); go("#fare"); });
    }

    async function run(btn) {
      planner.from = await resolvePlace(from); planner.to = await resolvePlace(to);
      if (!planner.from || !planner.to) throw new Error("Enter a starting point and a destination.");
      btn && (btn.textContent = "Finding routes…");
      planner.results = await maps.route(planner.from, planner.to); planner.sel = 0;
      const best = planner.results[0];
      recent.add({ kind: "trip", from: planner.from, to: planner.to, km: best.km, minutes: best.minutes });
      draw();
    }
    $("#planForm").addEventListener("submit", (e) => { e.preventDefault(); const b = $('button[type="submit"]', e.target); busy(b, () => run(b)); });
    $("#swapBtn").addEventListener("click", () => { const a = from.get(), b = to.get(); from.set(b); to.set(a); planner.from = b; planner.to = a; planner.results = null; draw(); });
    $("#locBtn").addEventListener("click", (e) => busy(e.currentTarget, async () => {
      e.currentTarget.textContent = "Locating…";
      const p = await maps.currentPosition();
      let place; try { place = await maps.reverse(p.lat, p.lon); } catch { place = { name: "My location", short: "My location", lat: p.lat, lon: p.lon }; }
      place.short = "My location"; from.set(place); planner.from = place; planner.results = null; draw();
    }));
    [from, to].forEach((api) => api.input.addEventListener("picked", () => { planner.from = from.get(); planner.to = to.get(); planner.results = null; draw(); }));
    draw();
    if (pre && planner.from && planner.to) busy($('#planForm button[type="submit"]'), () => run());
  }

  /* ---------- Community routes ---------- */
  const routeFilter = { q: "", vehicle: "", pending: false };
  async function viewRoutes() {
    app.innerHTML = `
      <div class="page-head"><div><h1>Community routes</h1><p class="muted">Step-by-step commutes shared by other commuters and checked by SakayGo admins.</p></div><a class="btn sign" href="#submit">+ Submit a route</a></div>
      <form class="card row" id="rf" style="margin-bottom:18px" role="search">
        <input id="rq" type="search" placeholder="Search a place, landmark or route" style="flex:3 1 220px" value="${esc(routeFilter.q)}">
        <select id="rv" style="flex:1 1 160px" aria-label="Vehicle type"><option value="">All vehicles</option>${Object.entries(STEP_MODES).filter(([k]) => k !== "walk").map(([k, v]) => `<option value="${k}" ${routeFilter.vehicle === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
        <label class="row small" style="gap:6px"><input type="checkbox" id="rp" style="width:auto" ${routeFilter.pending ? "checked" : ""}> Include routes awaiting review</label>
      </form>
      <div id="rlist"><div class="loading">Loading routes…</div></div>`;
    let t;
    const load = async () => {
      routeFilter.q = $("#rq").value; routeFilter.vehicle = $("#rv").value; routeFilter.pending = $("#rp").checked;
      const rows = await store.listRoutes({ q: routeFilter.q, vehicle: routeFilter.vehicle, includePending: routeFilter.pending });
      $("#rlist").innerHTML = rows.length ? `<p class="small muted" style="margin-bottom:10px">${rows.length} route${rows.length > 1 ? "s" : ""}</p><div class="route-list">${rows.map(routeCard).join("")}</div>`
        : `<div class="card empty"><b>No routes match</b>Try a nearby landmark or a different vehicle. Know a good route? <a href="#submit">Share it</a>.</div>`;
    };
    $("#rf").addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 250); });
    $("#rf").addEventListener("submit", (e) => { e.preventDefault(); load(); });
    await load();
  }

  async function viewRoute([id]) {
    const r = await store.getRoute(id);
    if (!r) { app.innerHTML = `<div class="card empty"><b>Route not found</b>It may have been removed or is still under review. <a href="#routes">Browse routes</a></div>`; return; }
    const [reviews, alerts, saved] = await Promise.all([store.listReviews(id), store.listAlerts({ routeId: id }), me ? store.isSaved(id) : false]);
    const mine = me && reviews.find((x) => x.user_id === me.id);
    const isAdmin = me && me.role === "admin";
    app.innerHTML = `
      <p style="margin-bottom:10px"><a href="#routes">← All routes</a></p>
      <div class="page-head"><div><div class="row" style="margin-bottom:6px">${statusPill(r.status)}${r.outdated >= 2 && r.outdated >= r.up ? '<span class="pill bad">Reported outdated by commuters</span>' : ""}</div>
        <h1>${esc(r.title)}</h1><p class="muted">Shared by ${esc(r.submitter_name)} · ${timeAgo(r.created_at)}</p></div></div>
      <div class="split">
        <div class="stack">
          <div class="card stack">
            <div class="od" style="font-size:.95rem"><i></i><span><b>From</b> ${esc(r.origin)}</span><i class="to"></i><span><b>To</b> ${esc(r.destination)}</span></div>
            <div class="meta" style="border:0;padding:0"><span>Total fare <b>${peso(r.total_fare)}</b></span><span>Travel time <b>${fmtMin(r.duration_min || 0)}</b></span>${r.review_count ? `<span>${stars(r.avg_rating)} ${r.avg_rating.toFixed(1)} (${r.review_count})</span>` : ""}</div>
          </div>
          <div class="card stack">
            <h3>Did this route work for you?</h3>
            <div class="row">
              <button class="btn ${r.my_up ? "on" : "ghost"}" id="upBtn" type="button">▲ Worked · ${r.up}</button>
              <button class="btn ${r.my_outdated ? "on-bad" : "ghost"}" id="oldBtn" type="button">Outdated · ${r.outdated}</button>
            </div>
            <div class="row">
              <button class="btn ghost" id="saveBtn" type="button">${saved ? "★ Saved" : "☆ Save route"}</button>
              <button class="btn ghost" id="cardBtn" type="button">Download route card</button>
              <button class="btn ghost" id="shareBtn" type="button">Copy link</button>
            </div>
          </div>
          ${isAdmin ? `<div class="card stack"><h3>Admin review</h3><p class="small muted">Verifying gives the submitter ${cfg.pointsPerVerifiedRoute} points. Disapproving a verified route removes them.</p><div class="row">
            ${r.status !== "verified" ? '<button class="btn" data-status="verified" type="button">Approve and verify</button>' : '<button class="btn danger" data-status="flagged" type="button">Disapprove</button>'}
            ${r.status === "pending" ? '<button class="btn ghost" data-status="flagged" type="button">Flag</button>' : ""}</div></div>` : ""}
          <div class="card stack"><div class="row" style="justify-content:space-between"><h3>Alerts on this route</h3><a class="small" href="#alerts/route/${esc(r.id)}">Post an alert</a></div>
            ${alerts.length ? alerts.map(alertItem).join("") : '<p class="small muted">No alerts in the last 48 hours.</p>'}</div>
        </div>
        <div class="stack">
          <div class="card"><h3 style="margin-bottom:6px">Steps</h3>
            <ol class="steps">${r.steps.map((s) => `<li><span class="mode-ic">${icon(s.mode)}</span><div><b>${esc(STEP_MODES[s.mode] || s.mode)}</b><p>${esc(s.instruction)}</p>${s.landmark ? `<p class="landmark">Landmark: ${esc(s.landmark)}</p>` : ""}</div><span class="fare">${s.fare ? peso(s.fare) : ""}</span></li>`).join("")}</ol>
            ${r.notes ? `<p class="notice" style="margin-top:8px">${esc(r.notes)}</p>` : ""}
          </div>
          <div class="card stack" id="reviews"><h3>Reviews</h3>
            ${me ? `<form id="revForm" class="stack"><div class="star-input" role="radiogroup" aria-label="Rating">${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="rating" id="st${n}" value="${n}" ${mine && mine.rating === n ? "checked" : ""}><label for="st${n}" title="${n} star${n > 1 ? "s" : ""}">★</label>`).join("")}</div>
              <textarea id="revText" placeholder="How was the trip? Any tips for other commuters?" maxlength="600">${esc(mine ? mine.comment : "")}</textarea>
              <button class="btn" type="submit">${mine ? "Update review" : "Post review"}</button></form>` : '<p class="small muted"><a href="#login">Sign in</a> to rate and review this route.</p>'}
            ${reviews.map((v) => `<div style="border-top:1px solid var(--line);padding-top:10px"><div class="row" style="justify-content:space-between"><b>${esc(v.user_name)}</b><span class="small muted">${timeAgo(v.created_at)}</span></div>${stars(v.rating)}<p>${esc(v.comment)}</p></div>`).join("") || '<p class="small muted">No reviews yet.</p>'}
          </div>
        </div>
      </div>`;
    const authed = (fn) => (e) => { if (!me) { toast("Sign in first to do that."); go("#login"); return; } busy(e.currentTarget, fn); };
    $("#upBtn").addEventListener("click", authed(async () => { await store.vote(id, "up"); render(); }));
    $("#oldBtn").addEventListener("click", authed(async () => { await store.vote(id, "outdated"); render(); }));
    $("#saveBtn").addEventListener("click", authed(async () => { const s = await store.toggleSave(id); toast(s ? "Saved to your account" : "Removed from saved routes"); render(); }));
    $("#cardBtn").addEventListener("click", () => downloadRouteCard(r));
    $("#shareBtn").addEventListener("click", async () => {
      const url = location.href;
      try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { toast(url); }
    });
    $$("[data-status]").forEach((b) => b.addEventListener("click", (e) => busy(e.currentTarget, async () => { await store.setRouteStatus(id, b.dataset.status); me = await store.currentUser(); toast(b.dataset.status === "verified" ? "Route verified" : "Route flagged"); render(); })));
    const rf = $("#revForm");
    rf && rf.addEventListener("submit", (e) => {
      e.preventDefault();
      const rating = +($('input[name="rating"]:checked', rf) || {}).value;
      if (!rating) { toast("Pick a star rating first.", "bad"); return; }
      busy($('button[type="submit"]', rf), async () => { await store.addReview(id, { rating, comment: $("#revText").value.trim() }); toast("Review posted"); render(); });
    });
  }

  function downloadRouteCard(r) {
    const W = 1080, pad = 70;
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    const wrap = (text, maxW, font) => { ctx.font = font; const words = String(text).split(" "); const lines = []; let line = ""; words.forEach((w) => { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }); if (line) lines.push(line); return lines; };
    const titleLines = wrap(r.title, W - pad * 2, "800 64px 'Bricolage Grotesque', sans-serif");
    const stepBlocks = r.steps.map((s) => ({ s, lines: wrap(s.instruction, W - pad * 2 - 230, "500 32px Figtree, sans-serif"), lm: s.landmark ? wrap("Landmark: " + s.landmark, W - pad * 2 - 230, "500 26px Figtree, sans-serif") : [] }));
    const H = 330 + titleLines.length * 74 + 150 + stepBlocks.reduce((a, b) => a + 70 + b.lines.length * 40 + b.lm.length * 34, 0) + 220;
    c.width = W; c.height = H;
    ctx.fillStyle = "#12355b"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#f3b81e"; ctx.fillRect(0, 0, W, 16);
    ctx.fillStyle = "#f3b81e"; ctx.fillRect(pad, 70, 74, 74);
    ctx.fillStyle = "#1d1600"; ctx.font = "800 34px 'Bricolage Grotesque', sans-serif"; ctx.fillText("SG", pad + 13, 120);
    ctx.fillStyle = "#fff"; ctx.font = "800 40px 'Bricolage Grotesque', sans-serif"; ctx.fillText("SakayGo route card", pad + 96, 120);
    let y = 250;
    ctx.font = "800 64px 'Bricolage Grotesque', sans-serif"; titleLines.forEach((l) => { ctx.fillText(l, pad, y); y += 74; });
    y += 10;
    ctx.font = "500 30px Figtree, sans-serif"; ctx.fillStyle = "#c9d6e4";
    ctx.fillText(("From: " + r.origin).slice(0, 60), pad, y); y += 44; ctx.fillText(("To: " + r.destination).slice(0, 60), pad, y); y += 60;
    ctx.fillStyle = "#ffffff"; const card = { x: pad - 20, y: y - 20, w: W - (pad - 20) * 2 };
    const cardH = stepBlocks.reduce((a, b) => a + 70 + b.lines.length * 40 + b.lm.length * 34, 0) + 20;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(card.x, card.y, card.w, cardH, 20) : ctx.rect(card.x, card.y, card.w, cardH); ctx.fill();
    y += 30;
    stepBlocks.forEach((b, i) => {
      ctx.fillStyle = "#12355b"; ctx.beginPath(); ctx.arc(pad + 26, y + 6, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "700 28px 'JetBrains Mono', monospace"; ctx.fillText(String(i + 1), pad + 17, y + 16);
      ctx.fillStyle = "#142233"; ctx.font = "700 30px Figtree, sans-serif"; ctx.fillText(STEP_MODES[b.s.mode] || b.s.mode, pad + 80, y + 14);
      if (b.s.fare) { ctx.font = "700 30px 'JetBrains Mono', monospace"; const t = peso(b.s.fare); ctx.fillText(t, W - pad - ctx.measureText(t).width, y + 14); }
      y += 54; ctx.font = "500 32px Figtree, sans-serif"; ctx.fillStyle = "#142233";
      b.lines.forEach((l) => { ctx.fillText(l, pad + 80, y); y += 40; });
      ctx.font = "500 26px Figtree, sans-serif"; ctx.fillStyle = "#4a5a6c";
      b.lm.forEach((l) => { ctx.fillText(l, pad + 80, y); y += 34; });
      y += 16;
    });
    y += 70;
    ctx.fillStyle = "#f3b81e"; ctx.font = "800 56px 'JetBrains Mono', monospace"; ctx.fillText(peso(r.total_fare), pad, y);
    ctx.fillStyle = "#c9d6e4"; ctx.font = "500 30px Figtree, sans-serif"; ctx.fillText(`total fare · about ${fmtMin(r.duration_min || 0)}`, pad, y + 48);
    ctx.fillText(r.status === "verified" ? "Verified by SakayGo" : "Community route, not yet verified", pad, y + 92);
    c.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "sakaygo-" + r.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast("Route card downloaded");
    }, "image/png");
  }

  /* ---------- Alerts ---------- */
  async function viewAlerts(params) {
    const preRoute = params[0] === "route" ? params[1] : "";
    const [alerts, routes] = await Promise.all([store.listAlerts(), store.listRoutes({ includePending: true })]);
    app.innerHTML = `
      <div class="page-head"><div><h1>Commuter alerts</h1><p class="muted">Reports from commuters in the last 48 hours.</p></div></div>
      <div class="split">
        <div>${me ? `<form class="card stack" id="alertForm"><h3>Post an alert</h3>
            <label class="field">What's happening?<select id="aType">${Object.entries(ALERT_TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></label>
            <label class="field">Where?<input id="aLoc" required maxlength="120" placeholder="e.g. EDSA Kamuning, northbound"></label>
            <label class="field">Related route <span class="hint">Optional</span><select id="aRoute"><option value="">None</option>${routes.map((r) => `<option value="${esc(r.id)}" ${r.id === preRoute ? "selected" : ""}>${esc(r.title)}</option>`).join("")}</select></label>
            <label class="field">Details<textarea id="aMsg" maxlength="280" placeholder="How long is the delay? Which direction?"></textarea></label>
            <button class="btn sign" type="submit">Post alert</button></form>`
          : '<div class="card stack"><h3>Seen something on the road?</h3><p class="muted">Sign in to post traffic, road block, queue and vehicle alerts for other commuters.</p><a class="btn" href="#login">Sign in to post</a></div>'}</div>
        <div class="stack">${alerts.map(alertItem).join("") || '<div class="card empty"><b>No alerts right now</b>Nothing reported in the last 48 hours.</div>'}</div>
      </div>`;
    const f = $("#alertForm");
    f && f.addEventListener("submit", (e) => {
      e.preventDefault();
      busy($('button[type="submit"]', f), async () => {
        await store.postAlert({ type: $("#aType").value, location: $("#aLoc").value.trim(), message: $("#aMsg").value.trim(), route_id: $("#aRoute").value || null });
        toast("Alert posted. Salamat!"); go("#alerts");
      });
    });
  }

  /* ---------- Submit route ---------- */
  async function viewSubmit() {
    if (!me) return needLogin();
    app.innerHTML = `
      <div class="page-head"><div><h1>Submit a route</h1><p class="muted">Share a commute you've taken. An admin checks it before it's listed as verified, and you earn ${cfg.pointsPerVerifiedRoute} points when it is.</p></div></div>
      <form class="card stack" id="subForm">
        <label class="field">Route title<input id="sTitle" required maxlength="140" placeholder="e.g. Cubao to Ayala Avenue, Makati"></label>
        <div class="grid-2"><label class="field">Starting point<input id="sOrigin" required maxlength="160" placeholder="Exact pickup spot or landmark"></label>
          <label class="field">Destination<input id="sDest" required maxlength="160"></label></div>
        <div class="stack"><div class="eyebrow">Steps</div><div id="stepsEd" class="stack"></div>
          <button class="btn ghost" type="button" id="addStep">+ Add step</button></div>
        <div class="grid-2"><label class="field">Total fare (₱)<input id="sFare" type="number" min="0" step="0.25" inputmode="decimal"><span class="hint">Leave blank to add up the step fares.</span></label>
          <label class="field">Travel time (minutes)<input id="sDur" type="number" min="1" step="1" required inputmode="numeric"></label></div>
        <label class="field">Tips for other commuters <span class="hint">Optional</span><textarea id="sNotes" maxlength="500" placeholder="Best time to ride, where the queue forms, what the signboard says…"></textarea></label>
        <button class="btn sign" type="submit">Submit for review</button>
      </form>`;
    const ed = $("#stepsEd");
    const addStep = (s = {}) => {
      const row = document.createElement("div");
      row.className = "step-editor card flat";
      row.innerHTML = `<label class="field">Ride<select class="st-mode">${Object.entries(STEP_MODES).map(([k, v]) => `<option value="${k}" ${s.mode === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
        <label class="field wide">Instruction<input class="st-ins" required maxlength="220" placeholder="Ride the jeep marked …, get off at …" value="${esc(s.instruction || "")}"></label>
        <label class="field">Landmark<input class="st-lm" maxlength="120" value="${esc(s.landmark || "")}"></label>
        <label class="field">Fare (₱)<input class="st-fare" type="number" min="0" step="0.25" value="${s.fare ?? ""}"></label>
        <button class="btn ghost small st-del" type="button" aria-label="Remove step" style="height:44px">✕</button>`;
      $(".st-del", row).addEventListener("click", () => { if ($$(".step-editor", ed).length > 1) row.remove(); });
      ed.appendChild(row);
    };
    addStep({ mode: "jeepney" });
    $("#addStep").addEventListener("click", () => addStep({ mode: "walk" }));
    $("#subForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const steps = $$(".step-editor", ed).map((r) => ({ mode: $(".st-mode", r).value, instruction: $(".st-ins", r).value.trim(), landmark: $(".st-lm", r).value.trim(), fare: parseFloat($(".st-fare", r).value) || 0 }));
      const fareIn = $("#sFare").value;
      const data = { title: $("#sTitle").value.trim(), origin: $("#sOrigin").value.trim(), destination: $("#sDest").value.trim(), steps,
        total_fare: fareIn === "" ? steps.reduce((a, s) => a + s.fare, 0) : parseFloat(fareIn), duration_min: parseInt($("#sDur").value, 10) || 0, notes: $("#sNotes").value.trim() };
      busy($('button[type="submit"]', e.target), async () => { const id = await store.submitRoute(data); toast("Submitted. An admin will review it soon."); go("#route/" + id); });
    });
  }

  /* ---------- Saved, profile, leaderboard, recent ---------- */
  async function viewSaved() {
    if (!me) return needLogin();
    const rows = await store.listSaved();
    app.innerHTML = `<div class="page-head"><div><h1>Saved routes</h1><p class="muted">Routes you bookmarked, synced to your account.</p></div></div>
      ${rows.length ? `<div class="route-list">${rows.map(routeCard).join("")}</div>` : '<div class="card empty"><b>No saved routes yet</b>Open any route and tap "Save route". <a href="#routes">Browse routes</a></div>'}`;
  }

  async function viewProfile() {
    if (!me) return needLogin();
    const subs = await store.mySubmissions();
    const lv = levelFor(me.points);
    app.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">${esc(lv.cur.name)}</div><h1>${esc(me.name)}</h1><p class="muted">${esc(me.email)}${me.role === "admin" ? ' · <span class="pill sign">Admin</span>' : ""}</p></div>
        <div class="row">${me.role === "admin" ? '<a class="btn" href="#admin">Review submissions</a>' : ""}<a class="btn ghost" href="#saved">Saved routes</a><button class="btn ghost" id="outBtn" type="button">Log out</button></div></div>
      <div class="split">
        <div class="stack">
          <div class="card stack"><div class="row" style="justify-content:space-between"><h3>Points</h3><span class="mono" style="font-size:1.6rem;font-weight:700">${me.points}</span></div>
            <div class="level-bar" role="progressbar" aria-valuenow="${Math.round(lv.pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${lv.pct}%"></i></div>
            <p class="small muted">${lv.next ? `${lv.next.min - me.points} points to <b>${esc(lv.next.name)}</b>. Each verified route earns ${cfg.pointsPerVerifiedRoute} points.` : "Top level reached. Mabuhay!"}</p>
            <div class="chips">${LEVELS.map((l, i) => `<span class="pill ${i <= lv.idx ? "sign" : ""}">${esc(l.name)} · ${l.min}</span>`).join("")}</div></div>
          <form class="card stack" id="profForm"><h3>Edit profile</h3>
            <label class="field">Display name<input id="pName" required maxlength="60" value="${esc(me.name)}"></label>
            <label class="field">Home city<input id="pCity" maxlength="60" value="${esc(me.home_city)}" placeholder="e.g. Quezon City"></label>
            <label class="field">About you<textarea id="pBio" maxlength="240">${esc(me.bio)}</textarea></label>
            <button class="btn" type="submit">Save profile</button></form>
          <div class="card stack"><h3>Delete account</h3><p class="small muted">This removes your profile, saved routes, reviews, alerts and submitted routes. It can't be undone.</p>
            <div id="delZone"><button class="btn ghost" type="button" id="delStart">Delete my account</button></div></div>
        </div>
        <div class="stack"><h2>My submissions</h2>
          ${subs.length ? subs.map((r) => `<a class="card row" href="#route/${esc(r.id)}" style="justify-content:space-between;text-decoration:none;color:inherit"><span><b>${esc(r.title)}</b><br><span class="small muted">Submitted ${timeAgo(r.created_at)} · ▲ ${r.up}</span></span>${statusPill(r.status)}</a>`).join("")
            : '<div class="card empty"><b>No submissions yet</b><a href="#submit">Share a route you know</a> and earn points when it\'s verified.</div>'}
        </div>
      </div>`;
    $("#outBtn").addEventListener("click", async () => { await store.signOut(); toast("Logged out"); go("#home"); });
    $("#profForm").addEventListener("submit", (e) => { e.preventDefault(); busy($('button[type="submit"]', e.target), async () => { await store.updateProfile({ name: $("#pName").value, home_city: $("#pCity").value, bio: $("#pBio").value }); me = await store.currentUser(); paintChrome(); toast("Profile saved"); }); });
    $("#delStart").addEventListener("click", () => {
      $("#delZone").innerHTML = `<div class="notice bad stack"><label class="field">Type DELETE to confirm<input id="delConfirm" autocomplete="off"></label><div class="row"><button class="btn danger" id="delGo" type="button" disabled>Permanently delete</button><button class="btn ghost" id="delCancel" type="button">Cancel</button></div></div>`;
      $("#delConfirm").addEventListener("input", (e) => { $("#delGo").disabled = e.target.value !== "DELETE"; });
      $("#delCancel").addEventListener("click", () => render());
      $("#delGo").addEventListener("click", (e) => busy(e.currentTarget, async () => { await store.deleteAccount(); toast("Your account was deleted"); go("#home"); }));
    });
  }

  async function viewLeaderboard() {
    const rows = await store.leaderboard();
    app.innerHTML = `<div class="page-head"><div><h1>Leaderboard</h1><p class="muted">Commuters ranked by points from verified route submissions.</p></div><a class="btn sign" href="#submit">Earn points</a></div>
      <div class="card table-wrap"><table class="board"><thead><tr><th>#</th><th>Commuter</th><th>Level</th><th class="n">Verified routes</th><th class="n">Points</th></tr></thead><tbody>
      ${rows.map((u, i) => `<tr class="${me && u.id === me.id ? "me" : ""}"><td class="rank">${i + 1}</td><td><b>${esc(u.name)}</b>${me && u.id === me.id ? " (you)" : ""}</td><td>${esc(levelFor(u.points).cur.name)}</td><td class="n">${u.verified}</td><td class="n"><b>${u.points}</b></td></tr>`).join("") || '<tr><td colspan="5" class="empty">No commuters yet.</td></tr>'}
      </tbody></table></div>`;
  }

  async function viewRecent() {
    const list = recent.all();
    app.innerHTML = `<div class="page-head"><div><h1>Recent calculations</h1><p class="muted">Fares and trips you checked on this device.</p></div>${list.length ? '<button class="btn ghost" id="clr" type="button">Clear history</button>' : ""}</div>
      <div class="stack">${list.map((x, i) => x.kind === "trip"
        ? `<button class="card option" data-i="${i}" type="button"><span><span class="pill">Trip</span> <b>${esc(x.from.short)} → ${esc(x.to.short)}</b><br><span class="small muted">${timeAgo(x.at)}</span></span><span style="text-align:right"><span class="big">${fmtKm(x.km)}</span><br><span class="small muted">${fmtMin(x.minutes)}</span></span></button>`
        : `<button class="card option" data-i="${i}" type="button"><span><span class="pill">Fare</span> <b>${esc(x.label)}</b><br><span class="small muted">${x.km} km · ${esc(x.discountLabel)}${x.from ? ` · ${esc(x.from.short)} → ${esc(x.to.short)}` : ""} · ${timeAgo(x.at)}</span></span><span class="big">${peso(x.total)}</span></button>`).join("")
      || '<div class="card empty"><b>Nothing here yet</b>Calculations from the <a href="#fare">fare calculator</a> and <a href="#planner">trip planner</a> show up here.</div>'}</div>`;
    $$(".option[data-i]").forEach((b) => b.addEventListener("click", () => {
      const x = list[+b.dataset.i];
      if (x.kind === "trip") { ls.set("sg_trip_prefill", { from: x.from, to: x.to }); go("#planner"); }
      else { ls.set("sg_fare_prefill", x); go("#fare"); }
    }));
    const c = $("#clr"); c && c.addEventListener("click", () => { recent.clear(); render(); });
  }

  /* ---------- Admin ---------- */
  async function viewAdmin() {
    if (!me) return needLogin();
    if (me.role !== "admin") { app.innerHTML = '<div class="card empty"><b>Admins only</b>This page is for SakayGo route reviewers.</div>'; return; }
    const q = await store.adminQueue();
    const row = (r, actions) => `<div class="card stack"><div class="row" style="justify-content:space-between"><a href="#route/${esc(r.id)}"><b>${esc(r.title)}</b></a>${statusPill(r.status)}</div>
      <p class="small muted">${esc(r.origin)} → ${esc(r.destination)} · ${r.steps.length} step${r.steps.length > 1 ? "s" : ""} · ${peso(r.total_fare)} · by ${esc(r.submitter_name)} · ${timeAgo(r.created_at)}</p>
      <ol class="small" style="margin:0;padding-left:18px">${r.steps.map((s) => `<li>${esc(STEP_MODES[s.mode] || s.mode)}: ${esc(s.instruction)}</li>`).join("")}</ol>
      <div class="row">${actions(r)}</div></div>`;
    const btn = (id, status, label, cls = "") => `<button class="btn small ${cls}" data-id="${esc(id)}" data-status="${status}" type="button">${label}</button>`;
    app.innerHTML = `<div class="page-head"><div><h1>Admin review</h1><p class="muted">${q.pending.length} pending · ${q.verified.length} verified · ${q.flagged.length} flagged</p></div></div>
      <div class="stack-lg">
        <section class="stack"><h2>Waiting for review</h2>${q.pending.map((r) => row(r, (r) => btn(r.id, "verified", "Approve and verify") + btn(r.id, "flagged", "Flag", "ghost"))).join("") || '<div class="card empty"><b>Queue is clear</b>No routes are waiting.</div>'}</section>
        <section class="stack"><h2>Verified</h2>${q.verified.map((r) => row(r, (r) => btn(r.id, "flagged", "Disapprove", "danger") + `<span class="small muted">▲ ${r.up} · outdated ${r.outdated}</span>`)).join("") || '<p class="muted">None yet.</p>'}</section>
        <section class="stack"><h2>Flagged</h2>${q.flagged.map((r) => row(r, (r) => btn(r.id, "verified", "Verify") + btn(r.id, "pending", "Back to pending", "ghost"))).join("") || '<p class="muted">None.</p>'}</section>
      </div>`;
    $$("[data-status]").forEach((b) => b.addEventListener("click", (e) => busy(e.currentTarget, async () => { await store.setRouteStatus(b.dataset.id, b.dataset.status); toast("Status updated"); render(); })));
  }

  /* ---------- Static pages ---------- */
  async function viewAbout() {
    app.innerHTML = `<div class="stack-lg" style="max-width:720px">
      <div><div class="eyebrow">About</div><h1>Commuting is easier when you know the fare and the way.</h1></div>
      <p>SakayGo helps commuters in the Philippines estimate fares for jeepneys, modern jeepneys, city buses and tricycles, plan trips on the map, and learn routes from people who ride them every day.</p>
      <div class="card stack"><h3>Where the numbers come from</h3>
        <p>Jeepney and bus fares follow the LTFRB fare matrix: a base fare for the first kilometers, then a fixed rate for each succeeding kilometer, rounded to the nearest 25 centavos. Student, senior citizen and PWD passengers get 20% off by law (RA 11314, RA 9994, RA 10754).</p>
        <p>Tricycle fares are set by each city or municipality, so they're kept per city.</p>
        <p class="small muted">Fare data currently loaded from: <span class="mono">${esc(fares.loadedFrom)}</span> (version ${esc(fares.data.version)}).</p></div>
      <div class="card stack"><h3>Maps and directions</h3><p>Maps use OpenStreetMap. Place search uses Nominatim and directions use OSRM. Trip planner routes are driving routes, so they may not match the roads jeepneys and buses take, and fares shown for them are estimates.</p></div>
      <div class="card stack"><h3>Community routes</h3><p>Routes are submitted by commuters and reviewed by admins. Upvote routes that worked, mark ones that changed as outdated, and post alerts so others can adjust.</p></div>
    </div>`;
  }

  async function viewContact() {
    app.innerHTML = `<div class="split"><div class="stack"><h1>Contact us</h1><p class="muted">Found a wrong fare, a broken route or a bug? Tell us. You can also email <b class="mono">${esc(cfg.contactEmail)}</b>.</p></div>
      <form class="card stack" id="cForm"><label class="field">Name<input id="cName" required maxlength="80" value="${esc(me ? me.name : "")}"></label>
        <label class="field">Email<input id="cEmail" type="email" required value="${esc(me ? me.email : "")}"></label>
        <label class="field">Message<textarea id="cMsg" required maxlength="2000"></textarea></label>
        <button class="btn sign" type="submit">Send message</button></form></div>`;
    $("#cForm").addEventListener("submit", (e) => { e.preventDefault(); busy($('button[type="submit"]', e.target), async () => {
      await store.sendContact({ name: $("#cName").value.trim(), email: $("#cEmail").value.trim(), message: $("#cMsg").value.trim() });
      e.target.innerHTML = '<div class="notice ok"><b>Message sent.</b> Salamat! We\'ll reply by email.</div>';
    }); });
  }

  /* ---------- Auth ---------- */
  function authPage(title, sub, body) { app.innerHTML = `<div class="auth-wrap stack"><div><h1>${title}</h1><p class="muted" style="margin-top:6px">${sub}</p></div><div class="card stack">${body}</div></div>`; }

  async function viewLogin() {
    if (me) return go("#profile");
    authPage("Sign in", "Welcome back, ka-commuter.", `
      <form id="lf" class="stack"><label class="field">Email<input id="lEmail" type="email" required autocomplete="email"></label>
        <label class="field">Password<input id="lPass" type="password" required autocomplete="current-password"></label>
        <button class="btn sign" type="submit">Sign in</button></form>
      <div class="row small" style="justify-content:space-between"><a href="#forgot">Forgot password?</a><a href="#register">Create an account</a></div>
      ${store.mode === "local" ? '<p class="notice small">Demo admin: <span class="mono">admin@sakaygo.demo</span> / <span class="mono">admin1234</span></p>' : ""}`);
    $("#lf").addEventListener("submit", (e) => { e.preventDefault(); busy($('button[type="submit"]', e.target), async () => { await store.signIn({ email: $("#lEmail").value, password: $("#lPass").value }); await refreshUser(); toast("Signed in"); go("#home"); }); });
  }
  async function viewRegister() {
    if (me) return go("#profile");
    authPage("Create your account", "Save routes, post alerts, review routes and earn points.", `
      <form id="rgf" class="stack"><label class="field">Display name<input id="rName" required maxlength="60" autocomplete="nickname"></label>
        <label class="field">Email<input id="rEmail" type="email" required autocomplete="email"></label>
        <label class="field">Password<input id="rPass" type="password" required minlength="8" autocomplete="new-password"><span class="hint">At least 8 characters.</span></label>
        <button class="btn sign" type="submit">Create account</button></form>
      <p class="small">Already have one? <a href="#login">Sign in</a></p>`);
    $("#rgf").addEventListener("submit", (e) => { e.preventDefault(); busy($('button[type="submit"]', e.target), async () => {
      const r = await store.signUp({ name: $("#rName").value, email: $("#rEmail").value, password: $("#rPass").value });
      if (r.needsConfirmation) { authPage("Check your email", "We sent you a confirmation link. Open it to finish creating your account.", '<a class="btn" href="#login">Back to sign in</a>'); return; }
      await refreshUser(); toast("Welcome to SakayGo!"); go("#home");
    }); });
  }
  async function viewForgot() {
    authPage("Reset your password", "Enter your account email and we'll send a reset link.", `
      <form id="ff" class="stack"><label class="field">Email<input id="fEmail" type="email" required autocomplete="email"></label><button class="btn sign" type="submit">Send reset link</button></form><div id="fOut"></div>`);
    $("#ff").addEventListener("submit", (e) => { e.preventDefault(); busy($('button[type="submit"]', e.target), async () => {
      const r = await store.sendReset($("#fEmail").value);
      $("#fOut").innerHTML = `<p class="notice ok">If that email has an account, a reset link is on its way.</p>${r.demoLink ? `<p class="notice small">Demo mode doesn't send email. <a href="${esc(r.demoLink)}">Open your reset link</a>.</p>` : ""}`;
    }); });
  }
  async function viewReset([token]) {
    authPage("Choose a new password", "Use at least 8 characters.", `
      <form id="nf" class="stack"><label class="field">New password<input id="nPass" type="password" required minlength="8" autocomplete="new-password"></label>
        <label class="field">Confirm password<input id="nPass2" type="password" required minlength="8" autocomplete="new-password"></label><button class="btn sign" type="submit">Update password</button></form>`);
    $("#nf").addEventListener("submit", (e) => { e.preventDefault();
      if ($("#nPass").value !== $("#nPass2").value) { toast("The passwords don't match.", "bad"); return; }
      busy($('button[type="submit"]', e.target), async () => { await store.resetPassword($("#nPass").value, token); await refreshUser(); toast("Password updated"); go("#home"); });
    });
  }

  /* =================== router & chrome =================== */
  const VIEWS = {
    home: viewHome, fare: viewFare, planner: viewPlanner, routes: viewRoutes, route: viewRoute, alerts: viewAlerts,
    submit: viewSubmit, saved: viewSaved, profile: viewProfile, leaderboard: viewLeaderboard, recent: viewRecent,
    admin: viewAdmin, about: viewAbout, contact: viewContact, login: viewLogin, register: viewRegister, forgot: viewForgot, reset: viewReset,
  };

  async function render() {
    const [name, ...params] = location.hash.replace(/^#/, "").split("/");
    const view = VIEWS[name || "home"];
    currentView = name || "home";
    if (activeMap) { activeMap.remove(); activeMap = null; }
    $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === currentView || (currentView === "route" && a.dataset.nav === "routes")));
    if (!view) { app.innerHTML = '<div class="card empty"><b>Page not found</b><a href="#home">Go to Home</a></div>'; return; }
    app.innerHTML = '<div class="loading">Loading…</div>';
    try { await view(params.map(decodeURIComponent)); }
    catch (e) { console.error(e); app.innerHTML = `<div class="card empty"><b>Something went wrong</b>${esc(e.message)}<br><br><button class="btn ghost" onclick="location.reload()">Reload</button></div>`; }
    window.scrollTo(0, 0);
  }

  function paintChrome() {
    const theme = document.documentElement.getAttribute("data-theme");
    $("#themeBtn").textContent = theme === "dark" ? "☀" : "☾";
    $("#themeBtn").title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    $("#accountSlot").innerHTML = me
      ? `<a class="icon-btn" href="#profile" title="Your profile"><span class="avatar">${esc((me.name || "?").trim()[0].toUpperCase())}</span><span class="mono small">${me.points} pts</span></a>`
      : '<a class="icon-btn" href="#login">Sign in</a>';
  }
  async function refreshUser() { me = await store.currentUser(); paintChrome(); }

  $("#themeBtn").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("sg_theme", next); } catch {}
    paintChrome();
  });

  // Pull-to-refresh on Home (touch devices)
  (function pullToRefresh() {
    let startY = null, dy = 0;
    window.addEventListener("touchstart", (e) => { if (currentView === "home" && window.scrollY <= 0) startY = e.touches[0].clientY; }, { passive: true });
    window.addEventListener("touchmove", (e) => {
      if (startY == null) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      const p = $("#ptr"); if (!p) return;
      p.style.height = Math.min(dy * 0.5, 60) + "px";
      p.textContent = dy > 120 ? "Release to refresh" : "Pull to refresh";
    }, { passive: true });
    window.addEventListener("touchend", async () => {
      if (startY == null) return;
      const p = $("#ptr"); const go_ = dy > 120; startY = null; dy = 0;
      if (!p) return;
      if (go_) { p.textContent = "Refreshing…"; p.style.height = "40px"; await refreshUser(); await render(); toast("Updated"); }
      else p.style.height = "0";
    });
  })();

  async function boot() {
    await Promise.all([store.init(), fares.load()]);
    store.onAuth(async () => { await refreshUser(); });
    await refreshUser();
    if (store.mode === "local") {
      const b = $("#demoBanner");
      b.hidden = false;
      b.innerHTML = 'Demo mode: accounts and routes are stored in this browser only. Connect Supabase in <span class="mono">js/config.js</span> to go live.';
    }
    $("#fareSource").textContent = "Fare matrix " + fares.data.version;
    window.addEventListener("hashchange", render);
    render();
  }
  boot().catch((e) => { console.error(e); app.innerHTML = `<div class="card empty"><b>SakayGo couldn't start</b>${esc(e.message)}</div>`; });
})();
