/* Bundled fare matrix data.
 *
 * IMPORTANT: verify these values against the latest LTFRB memorandum circulars
 * and your LGU's tricycle fare ordinance before going live. Fares change; this
 * file (or the JSON at config.fareMatrixUrl) is the single place to update them.
 *
 * Fare rule for every distance-based mode:
 *   fare = base (covers the first baseKm) + ceil(km - baseKm) * perKm
 *   result rounded to the nearest ₱0.25
 * Discounted fare = regular fare less discountPct, rounded the same way.
 */
window.SG_FARE_DATA = {
  version: "2026-11-bundled",
  currency: "PHP",
  roundTo: 0.25,
  discounts: {
    none:    { label: "Regular",               pct: 0 },
    student: { label: "Student",               pct: 20, law: "RA 11314 (Student Fare Discount Act)" },
    senior:  { label: "Senior citizen / PWD",  pct: 20, law: "RA 9994 and RA 10754" },
  },
  modes: {
    puj_traditional: {
      label: "Traditional jeepney",
      short: "Jeepney",
      base: 13.0, baseKm: 4, perKm: 1.8,
      source: "LTFRB fare matrix for PUJ (Metro Manila, Regions III & IV)",
    },
    puj_modern: {
      label: "Modern jeepney (non-aircon)",
      short: "Modern jeep",
      base: 15.0, baseKm: 4, perKm: 1.8,
      source: "LTFRB fare matrix for modern PUJ",
    },
    puj_modern_ac: {
      label: "Modern jeepney (aircon)",
      short: "Modern jeep AC",
      base: 15.0, baseKm: 4, perKm: 2.2,
      source: "LTFRB fare matrix for modern PUJ",
    },
    bus_city: {
      label: "City bus (ordinary)",
      short: "City bus",
      base: 13.0, baseKm: 5, perKm: 2.25,
      source: "LTFRB fare matrix for city buses (Metro Manila)",
    },
    bus_city_ac: {
      label: "City bus (aircon)",
      short: "Aircon bus",
      base: 15.0, baseKm: 5, perKm: 2.65,
      source: "LTFRB fare matrix for city buses (Metro Manila)",
    },
  },
  /* Tricycle fares are set by each city/municipality. The values below are
   * SAMPLE placeholders so the calculator works out of the box. Replace them
   * with figures from each LGU's current tricycle fare ordinance. */
  tricycle: {
    label: "Tricycle",
    sample: true,
    cities: {
      quezon_city: { name: "Quezon City",  base: 15, baseKm: 1, perKm: 5, specialMultiplier: 4 },
      manila:      { name: "Manila",       base: 15, baseKm: 1, perKm: 4, specialMultiplier: 4 },
      makati:      { name: "Makati",       base: 15, baseKm: 1, perKm: 5, specialMultiplier: 4 },
      pasig:       { name: "Pasig",        base: 14, baseKm: 1, perKm: 4, specialMultiplier: 4 },
      cebu_city:   { name: "Cebu City",    base: 12, baseKm: 1, perKm: 3, specialMultiplier: 4 },
      davao_city:  { name: "Davao City",   base: 12, baseKm: 2, perKm: 2, specialMultiplier: 4 },
      iloilo_city: { name: "Iloilo City",  base: 12, baseKm: 1, perKm: 3, specialMultiplier: 4 },
      bacolod:     { name: "Bacolod City", base: 13, baseKm: 1, perKm: 3, specialMultiplier: 4 },
    },
  },
};
