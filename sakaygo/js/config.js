/* SakayGo configuration.
 *
 * backend:
 *   "local"    – everything (accounts, routes, reviews, alerts) is stored in this
 *                browser's localStorage. Good for demos and local development.
 *   "supabase" – real multi-user backend. Run supabase/schema.sql in your project,
 *                then paste the project URL and anon key below.
 *
 * fareMatrixUrl:
 *   Optional URL of a JSON file with the same shape as js/fare-matrices.js
 *   (window.SG_FARE_DATA). When set, SakayGo loads fares from it on start-up and
 *   falls back to the bundled matrix if the request fails. Point it at your own
 *   fare-matrix API or a JSON file you update when LTFRB/LGUs issue new fares.
 */
window.SAKAYGO_CONFIG = {
  backend: "supabase",
  supabaseUrl: "https://qyjbqgaqfsmsmxiwpfak.supabase.co",
  supabaseAnonKey: "sb_publishable_p-ytE8qAFDOrDjZ7TRWi0A_9yYbTber",

  fareMatrixUrl: "",

  // Maps & routing (OpenStreetMap stack, no API key needed).
  // For production traffic, use your own or a commercial instance; the public
  // servers have fair-use limits (Nominatim: max 1 request/second).
  tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  nominatimUrl: "https://nominatim.openstreetmap.org",
  osrmUrl: "https://router.project-osrm.org",

  pointsPerVerifiedRoute: 50,
  contactEmail: "work.patkyu@gmail.com",
};
