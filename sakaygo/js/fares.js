/* Fare engine: loads the fare matrix (remote API or bundled) and computes fares. */
(function () {
  const SG = (window.SG = window.SG || {});
  const cfg = window.SAKAYGO_CONFIG;

  const fares = {
    data: window.SG_FARE_DATA,
    loadedFrom: "bundled",

    async load() {
      if (!cfg.fareMatrixUrl) return;
      try {
        const res = await fetch(cfg.fareMatrixUrl, { cache: "no-cache" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        if (!json.modes || !json.discounts) throw new Error("Unexpected fare matrix format");
        fares.data = json;
        fares.loadedFrom = cfg.fareMatrixUrl;
      } catch (e) {
        console.warn("Fare matrix API unavailable, using bundled data:", e);
      }
    },

    round(n) {
      const step = fares.data.roundTo || 0.25;
      return Math.round(n / step) * step;
    },

    /** All selectable modes, tricycle last. */
    modeList() {
      const list = Object.entries(fares.data.modes).map(([id, m]) => ({ id, label: m.label, short: m.short }));
      list.push({ id: "tricycle", label: fares.data.tricycle.label, short: "Tricycle" });
      return list;
    },

    cityList() {
      return Object.entries(fares.data.tricycle.cities).map(([id, c]) => ({ id, name: c.name }));
    },

    /**
     * @param {{mode:string, km:number, discount:string, city?:string, special?:boolean}} p
     * @returns breakdown object
     */
    calc({ mode, km, discount = "none", city, special = false }) {
      km = Math.max(0, Number(km) || 0);
      let m, label, source, sample = false, mult = 1;
      if (mode === "tricycle") {
        const t = fares.data.tricycle;
        m = t.cities[city] || Object.values(t.cities)[0];
        label = `${t.label} · ${m.name}`;
        source = t.sample ? "Sample city values – replace with the LGU ordinance" : (m.source || "LGU tricycle fare ordinance");
        sample = !!t.sample;
        if (special) mult = m.specialMultiplier || 1;
      } else {
        m = fares.data.modes[mode];
        if (!m) throw new Error("Unknown mode " + mode);
        label = m.label;
        source = m.source;
      }
      const extraKm = Math.max(0, Math.ceil(km - m.baseKm - 1e-9));
      const extra = extraKm * m.perKm;
      const regularRaw = (m.base + extra) * mult;
      const regular = fares.round(regularRaw);
      const d = fares.data.discounts[discount] || fares.data.discounts.none;
      const total = d.pct ? fares.round(regularRaw * (1 - d.pct / 100)) : regular;

      const lines = [
        { label: `Base fare (first ${m.baseKm} km)`, amount: m.base },
        { label: `${extraKm} succeeding km × ₱${m.perKm.toFixed(2)}`, amount: extra },
      ];
      if (mult !== 1) lines.push({ label: `Special trip (× ${mult})`, amount: (m.base + extra) * (mult - 1) });
      lines.push({ label: "Regular fare (rounded to ₱0.25)", amount: regular, strong: true });
      if (d.pct) lines.push({ label: `${d.label} discount (${d.pct}%)`, amount: -(regular - total) });

      return {
        mode, km, discount, city, special, label, source, sample,
        discountLabel: d.label, discountLaw: d.law || "",
        lines, regular, total, extraKm,
      };
    },

    /** Quick estimates for every non-tricycle mode at a distance. */
    estimateAll(km, discount = "none") {
      return Object.keys(fares.data.modes).map((id) => {
        const r = fares.calc({ mode: id, km, discount });
        return { id, label: fares.data.modes[id].label, total: r.total };
      });
    },
  };

  SG.fares = fares;
})();
