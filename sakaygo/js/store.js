/* Data layer. Two interchangeable backends with the same interface:
 *   LocalStore    – localStorage (demo / offline)
 *   SupabaseStore – Supabase (Postgres + Auth), see supabase/schema.sql
 *
 * Normalized route shape returned by both:
 * { id, title, origin, destination, steps:[{mode, instruction, landmark, fare}],
 *   total_fare, duration_min, notes, status, submitted_by, submitter_name,
 *   created_at, up, outdated, my_up, my_outdated, avg_rating, review_count }
 */
(function () {
  const SG = (window.SG = window.SG || {});
  const cfg = window.SAKAYGO_CONFIG;
  const POINTS = cfg.pointsPerVerifiedRoute || 50;

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36));
  const now = () => new Date().toISOString();
  async function hash(s) {
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("sakaygo:" + s));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return "weak" + h;
    }
  }
  function fail(msg) { throw new Error(msg); }

  /* ------------------------------------------------------------------ */
  class LocalStore {
    constructor() { this.mode = "local"; this.key = "sg_db_v1"; this.db = null; this.listeners = []; }

    async init() {
      try { const d = JSON.parse(localStorage.getItem(this.key)); if (d && d.v === 1) this.db = d; } catch {}
      if (!this.db) { this.db = await seedData(); this.save(); }
    }
    save() { try { localStorage.setItem(this.key, JSON.stringify(this.db)); } catch (e) { console.warn(e); } }
    onAuth(fn) { this.listeners.push(fn); }
    emit() { this.listeners.forEach((f) => f()); }
    sessionId() { try { return localStorage.getItem("sg_session"); } catch { return null; } }
    me() { return this.db.users.find((u) => u.id === this.sessionId()) || null; }
    pub(u) { return u && { id: u.id, email: u.email, name: u.name, bio: u.bio || "", home_city: u.home_city || "", role: u.role, points: u.points || 0, created_at: u.created_at }; }
    need() { const u = this.me(); if (!u) fail("Please sign in first."); return u; }

    async currentUser() { return this.pub(this.me()); }
    async signUp({ name, email, password }) {
      email = email.trim().toLowerCase();
      if (this.db.users.some((u) => u.email === email)) fail("An account with this email already exists. Sign in instead.");
      const u = { id: uid(), email, name: name.trim(), passHash: await hash(password), role: "commuter", points: 0, created_at: now() };
      this.db.users.push(u); this.save();
      localStorage.setItem("sg_session", u.id); this.emit();
      return { needsConfirmation: false };
    }
    async signIn({ email, password }) {
      const u = this.db.users.find((x) => x.email === email.trim().toLowerCase());
      if (!u || u.passHash !== (await hash(password))) fail("Email or password is incorrect.");
      localStorage.setItem("sg_session", u.id); this.emit();
    }
    async signOut() { localStorage.removeItem("sg_session"); this.emit(); }
    async sendReset(email) {
      const u = this.db.users.find((x) => x.email === email.trim().toLowerCase());
      if (!u) return { demoLink: null };
      u.resetToken = uid(); this.save();
      return { demoLink: `#reset/${u.resetToken}` };
    }
    async resetPassword(password, token) {
      const u = token ? this.db.users.find((x) => x.resetToken === token) : this.me();
      if (!u) fail("This reset link is invalid or has already been used. Request a new one.");
      u.passHash = await hash(password); delete u.resetToken; this.save();
      localStorage.setItem("sg_session", u.id); this.emit();
    }
    async updateProfile(patch) {
      const u = this.need();
      ["name", "bio", "home_city"].forEach((k) => { if (k in patch) u[k] = String(patch[k]).trim(); });
      this.save(); this.emit();
    }
    async deleteAccount() {
      const u = this.need();
      const d = this.db;
      d.users = d.users.filter((x) => x.id !== u.id);
      d.saved = d.saved.filter((s) => s.user_id !== u.id);
      d.reviews = d.reviews.filter((r) => r.user_id !== u.id);
      d.alerts = d.alerts.filter((a) => a.user_id !== u.id);
      d.routes = d.routes.filter((r) => r.submitted_by !== u.id);
      d.routes.forEach((r) => { r.upvotes = r.upvotes.filter((x) => x !== u.id); r.outdatedVotes = r.outdatedVotes.filter((x) => x !== u.id); });
      this.save(); localStorage.removeItem("sg_session"); this.emit();
    }

    norm(r) {
      const me = this.sessionId();
      const reviews = this.db.reviews.filter((x) => x.route_id === r.id);
      const sub = this.db.users.find((u) => u.id === r.submitted_by);
      return {
        id: r.id, title: r.title, origin: r.origin, destination: r.destination, steps: r.steps,
        total_fare: r.total_fare, duration_min: r.duration_min, notes: r.notes || "", status: r.status,
        submitted_by: r.submitted_by, submitter_name: sub ? sub.name : "Former member", created_at: r.created_at,
        up: r.upvotes.length, outdated: r.outdatedVotes.length,
        my_up: r.upvotes.includes(me), my_outdated: r.outdatedVotes.includes(me),
        avg_rating: reviews.length ? reviews.reduce((a, b) => a + b.rating, 0) / reviews.length : 0,
        review_count: reviews.length,
      };
    }
    visible(r) {
      const me = this.me();
      return r.status !== "flagged" || (me && (me.role === "admin" || me.id === r.submitted_by));
    }
    async listRoutes({ q = "", vehicle = "", includePending = false } = {}) {
      const needle = q.trim().toLowerCase();
      return this.db.routes
        .filter((r) => this.visible(r))
        .filter((r) => r.status === "verified" || (includePending && r.status === "pending"))
        .filter((r) => !needle || [r.title, r.origin, r.destination, ...r.steps.map((s) => s.instruction + " " + s.landmark)].join(" ").toLowerCase().includes(needle))
        .filter((r) => !vehicle || r.steps.some((s) => s.mode === vehicle))
        .map((r) => this.norm(r))
        .sort((a, b) => b.up - b.outdated - (a.up - a.outdated) || b.created_at.localeCompare(a.created_at));
    }
    async getRoute(id) {
      const r = this.db.routes.find((x) => x.id === id);
      if (!r || !this.visible(r)) return null;
      return this.norm(r);
    }
    async submitRoute(data) {
      const u = this.need();
      const r = { id: uid(), ...data, status: "pending", submitted_by: u.id, created_at: now(), upvotes: [], outdatedVotes: [] };
      this.db.routes.push(r); this.save(); return r.id;
    }
    async mySubmissions() {
      const u = this.need();
      return this.db.routes.filter((r) => r.submitted_by === u.id).map((r) => this.norm(r)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    async vote(routeId, kind) {
      const u = this.need();
      const r = this.db.routes.find((x) => x.id === routeId);
      const key = kind === "up" ? "upvotes" : "outdatedVotes";
      r[key] = r[key].includes(u.id) ? r[key].filter((x) => x !== u.id) : [...r[key], u.id];
      this.save();
    }
    async listReviews(routeId) {
      return this.db.reviews.filter((x) => x.route_id === routeId)
        .map((x) => ({ ...x, user_name: (this.db.users.find((u) => u.id === x.user_id) || {}).name || "Former member" }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    async addReview(routeId, { rating, comment }) {
      const u = this.need();
      const existing = this.db.reviews.find((x) => x.route_id === routeId && x.user_id === u.id);
      if (existing) Object.assign(existing, { rating, comment, created_at: now() });
      else this.db.reviews.push({ id: uid(), route_id: routeId, user_id: u.id, rating, comment, created_at: now() });
      this.save();
    }
    async listAlerts({ routeId } = {}) {
      const cutoff = Date.now() - 48 * 3600e3;
      return this.db.alerts.filter((a) => Date.parse(a.created_at) > cutoff && (!routeId || a.route_id === routeId))
        .map((a) => ({ ...a, user_name: (this.db.users.find((u) => u.id === a.user_id) || {}).name || "Commuter" }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    async postAlert(a) {
      const u = this.need();
      this.db.alerts.push({ id: uid(), ...a, user_id: u.id, created_at: now() }); this.save();
    }
    async listSaved() {
      const u = this.need();
      const ids = this.db.saved.filter((s) => s.user_id === u.id).map((s) => s.route_id);
      return this.db.routes.filter((r) => ids.includes(r.id) && this.visible(r)).map((r) => this.norm(r));
    }
    async isSaved(routeId) { const me = this.sessionId(); return this.db.saved.some((s) => s.user_id === me && s.route_id === routeId); }
    async toggleSave(routeId) {
      const u = this.need();
      const i = this.db.saved.findIndex((s) => s.user_id === u.id && s.route_id === routeId);
      if (i >= 0) this.db.saved.splice(i, 1); else this.db.saved.push({ user_id: u.id, route_id: routeId, created_at: now() });
      this.save(); return i < 0;
    }
    async leaderboard() {
      return this.db.users.map((u) => ({ id: u.id, name: u.name, points: u.points || 0, verified: this.db.routes.filter((r) => r.submitted_by === u.id && r.status === "verified").length }))
        .sort((a, b) => b.points - a.points || b.verified - a.verified).slice(0, 50);
    }
    async adminQueue() {
      const u = this.need(); if (u.role !== "admin") fail("Admins only.");
      return {
        pending: this.db.routes.filter((r) => r.status === "pending").map((r) => this.norm(r)),
        verified: this.db.routes.filter((r) => r.status === "verified").map((r) => this.norm(r)),
        flagged: this.db.routes.filter((r) => r.status === "flagged").map((r) => this.norm(r)),
      };
    }
    async setRouteStatus(routeId, status) {
      const u = this.need(); if (u.role !== "admin") fail("Admins only.");
      const r = this.db.routes.find((x) => x.id === routeId);
      const sub = this.db.users.find((x) => x.id === r.submitted_by);
      if (sub && r.status !== "verified" && status === "verified") sub.points = (sub.points || 0) + POINTS;
      if (sub && r.status === "verified" && status !== "verified") sub.points = Math.max(0, (sub.points || 0) - POINTS);
      r.status = status; this.save();
    }
    async sendContact(msg) { this.db.messages.push({ id: uid(), ...msg, created_at: now() }); this.save(); }
  }

  async function seedData() {
    const t = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    const admin = { id: "u-admin", email: "admin@sakaygo.demo", name: "SakayGo Admin", passHash: await hash("admin1234"), role: "admin", points: 0, created_at: t(900) };
    const ana = { id: "u-ana", email: "ana@sakaygo.demo", name: "Ana R. (sample)", passHash: await hash("commuter123"), role: "commuter", points: 150, created_at: t(700) };
    const jun = { id: "u-jun", email: "jun@sakaygo.demo", name: "Jun D. (sample)", passHash: await hash("commuter123"), role: "commuter", points: 100, created_at: t(600) };
    const mae = { id: "u-mae", email: "mae@sakaygo.demo", name: "Mae L. (sample)", passHash: await hash("commuter123"), role: "commuter", points: 50, created_at: t(500) };
    const R = (id, by, h, status, o) => ({ id, submitted_by: by, created_at: t(h), status, upvotes: [], outdatedVotes: [], ...o });
    const routes = [
      R("r-cubao-ayala", "u-ana", 300, "verified", {
        title: "Cubao to Ayala Avenue, Makati", origin: "Gateway Mall, Cubao, Quezon City", destination: "Ayala Avenue, Makati",
        total_fare: 28, duration_min: 45, notes: "Avoid 7–9 AM if you can; the Cubao platform queue gets long.",
        steps: [
          { mode: "walk", instruction: "Walk through Gateway Mall to MRT-3 Araneta Center-Cubao station", landmark: "Gateway Mall bridgeway", fare: 0 },
          { mode: "rail", instruction: "Ride MRT-3 southbound to Ayala station", landmark: "Ayala station (Glorietta side)", fare: 28 },
          { mode: "walk", instruction: "Exit toward Ayala Avenue and walk along the covered walkway", landmark: "Ayala Triangle", fare: 0 },
        ] }),
      R("r-fairview-quiapo", "u-jun", 260, "verified", {
        title: "Fairview to Quiapo Church", origin: "SM City Fairview, Quezon City", destination: "Quiapo Church, Manila",
        total_fare: 41, duration_min: 95, notes: "Jeepneys signboarded \"Quiapo\" leave from the terminal beside SM Fairview.",
        steps: [
          { mode: "jeepney", instruction: "Ride a jeepney with the signboard \"Fairview – Quiapo\" via Commonwealth Ave", landmark: "Terminal beside SM City Fairview", fare: 41 },
          { mode: "walk", instruction: "Get off at Quezon Boulevard and walk to the church plaza", landmark: "Plaza Miranda", fare: 0 },
        ] }),
      R("r-ayala-it-park", "u-mae", 200, "verified", {
        title: "Ayala Center Cebu to Cebu IT Park", origin: "Ayala Center Cebu", destination: "Cebu IT Park, Lahug",
        total_fare: 13, duration_min: 20,
        steps: [
          { mode: "jeepney", instruction: "Ride jeepney 17B or 17C toward Apas", landmark: "Ayala Center terminal (Cebu Business Park side)", fare: 13 },
          { mode: "walk", instruction: "Get off at Salinas Drive and walk into IT Park", landmark: "Cebu IT Park main gate", fare: 0 },
        ] }),
      R("r-pitx-moa", "u-ana", 150, "verified", {
        title: "PITX to SM Mall of Asia", origin: "Parañaque Integrated Terminal Exchange (PITX)", destination: "SM Mall of Asia, Pasay",
        total_fare: 15, duration_min: 25,
        steps: [
          { mode: "modern_jeepney", instruction: "Ride a modern jeepney bound for MOA from the PITX arrival bays", landmark: "PITX Gate 2", fare: 15 },
        ] }),
      R("r-monumento-pitx", "u-jun", 100, "verified", {
        title: "Monumento to PITX via EDSA Carousel", origin: "Monumento, Caloocan", destination: "PITX, Parañaque",
        total_fare: 75.5, duration_min: 80, notes: "Board from the median busway stations only. Keep your card or cash ready.",
        steps: [
          { mode: "bus", instruction: "Ride the EDSA Carousel bus southbound from Monumento station", landmark: "Monumento median station", fare: 75.5 },
        ] }),
      R("r-up-katipunan", "u-mae", 30, "pending", {
        title: "UP Diliman to Katipunan (Ateneo)", origin: "UP Diliman Academic Oval", destination: "Ateneo Gate 2.5, Katipunan Ave",
        total_fare: 13, duration_min: 20,
        steps: [
          { mode: "jeepney", instruction: "Ride the \"UP – Katipunan\" jeepney from the Oval", landmark: "Shopping Center stop", fare: 13 },
        ] }),
    ];
    routes[0].upvotes = ["u-jun", "u-mae"]; routes[1].upvotes = ["u-ana"]; routes[3].upvotes = ["u-mae", "u-jun"]; routes[1].outdatedVotes = ["u-mae"];
    return {
      v: 1,
      users: [admin, ana, jun, mae],
      routes,
      reviews: [
        { id: "rv1", route_id: "r-cubao-ayala", user_id: "u-jun", rating: 5, comment: "Fastest way during rush hour. Bring exact change for the ticket.", created_at: t(120) },
        { id: "rv2", route_id: "r-cubao-ayala", user_id: "u-mae", rating: 4, comment: "Works, but the queue at Cubao was 20 minutes this morning.", created_at: t(30) },
        { id: "rv3", route_id: "r-ayala-it-park", user_id: "u-ana", rating: 5, comment: "Clear directions, easy ride.", created_at: t(40) },
      ],
      alerts: [
        { id: "al1", type: "traffic", location: "EDSA Guadalupe, southbound", message: "Heavy traffic up to Magallanes. Expect +30 min.", route_id: "r-monumento-pitx", user_id: "u-jun", created_at: t(1) },
        { id: "al2", type: "queue", location: "MRT-3 Araneta Center-Cubao", message: "Platform queue reaches the stairs.", route_id: "r-cubao-ayala", user_id: "u-ana", created_at: t(3) },
        { id: "al3", type: "no_vehicle", location: "SM Fairview terminal", message: "Few Quiapo jeepneys at the moment.", route_id: "r-fairview-quiapo", user_id: "u-mae", created_at: t(6) },
      ],
      saved: [],
      messages: [],
    };
  }

  /* ------------------------------------------------------------------ */
  class SupabaseStore {
    constructor() {
      this.mode = "supabase";
      this.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });
      this.user = null; this.profile = null; this.listeners = [];
    }
    async init() {
      const { data } = await this.sb.auth.getSession();
      this.user = data.session?.user || null;
      await this.loadProfile();
      this.sb.auth.onAuthStateChange(async (event, session) => {
        this.user = session?.user || null;
        await this.loadProfile();
        if (event === "PASSWORD_RECOVERY") location.hash = "#reset";
        this.listeners.forEach((f) => f(event));
      });
    }
    onAuth(fn) { this.listeners.push(fn); }
    async loadProfile() {
      if (!this.user) { this.profile = null; return; }
      const { data } = await this.sb.from("profiles").select("*").eq("id", this.user.id).maybeSingle();
      this.profile = data;
    }
    need() { if (!this.user) fail("Please sign in first."); return this.user; }
    chk({ data, error }) { if (error) fail(error.message); return data; }

    async currentUser() {
      if (!this.user) return null;
      const p = this.profile || {};
      return { id: this.user.id, email: this.user.email, name: p.display_name || this.user.email, bio: p.bio || "", home_city: p.home_city || "", role: p.role || "commuter", points: p.points || 0, created_at: p.created_at };
    }
    async signUp({ name, email, password }) {
      const data = this.chk(await this.sb.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: location.origin + location.pathname } }));
      return { needsConfirmation: !data.session };
    }
    async signIn({ email, password }) { this.chk(await this.sb.auth.signInWithPassword({ email, password })); }
    async signOut() { await this.sb.auth.signOut(); }
    async sendReset(email) { this.chk(await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); return { demoLink: null }; }
    async resetPassword(password) { this.chk(await this.sb.auth.updateUser({ password })); }
    async updateProfile(patch) {
      const u = this.need();
      const row = {};
      if ("name" in patch) row.display_name = patch.name.trim();
      if ("bio" in patch) row.bio = patch.bio.trim();
      if ("home_city" in patch) row.home_city = patch.home_city.trim();
      this.chk(await this.sb.from("profiles").update(row).eq("id", u.id));
      await this.loadProfile();
    }
    async deleteAccount() { this.chk(await this.sb.rpc("delete_my_account")); await this.sb.auth.signOut(); }

    async decorate(rows) {
      if (!rows.length || !this.user) return rows.map((r) => ({ ...r, my_up: false, my_outdated: false }));
      const mine = this.chk(await this.sb.from("route_votes").select("route_id,kind").eq("user_id", this.user.id).in("route_id", rows.map((r) => r.id)));
      return rows.map((r) => ({ ...r, my_up: mine.some((v) => v.route_id === r.id && v.kind === "up"), my_outdated: mine.some((v) => v.route_id === r.id && v.kind === "outdated") }));
    }
    async listRoutes({ q = "", vehicle = "", includePending = false } = {}) {
      let query = this.sb.from("route_stats").select("*").in("status", includePending ? ["verified", "pending"] : ["verified"]).limit(100);
      if (q.trim()) { const s = q.trim().replace(/[%,()]/g, " "); query = query.or(`title.ilike.%${s}%,origin.ilike.%${s}%,destination.ilike.%${s}%,search_text.ilike.%${s}%`); }
      if (vehicle) query = query.contains("modes", [vehicle]);
      const rows = this.chk(await query);
      rows.sort((a, b) => b.up - b.outdated - (a.up - a.outdated) || b.created_at.localeCompare(a.created_at));
      return this.decorate(rows);
    }
    async getRoute(id) {
      const row = this.chk(await this.sb.from("route_stats").select("*").eq("id", id).maybeSingle());
      return row ? (await this.decorate([row]))[0] : null;
    }
    async submitRoute(data) {
      const u = this.need();
      const row = this.chk(await this.sb.from("routes").insert({ ...data, submitted_by: u.id }).select("id").single());
      return row.id;
    }
    async mySubmissions() {
      const u = this.need();
      return this.decorate(this.chk(await this.sb.from("route_stats").select("*").eq("submitted_by", u.id).order("created_at", { ascending: false })));
    }
    async vote(routeId, kind) {
      const u = this.need();
      const existing = this.chk(await this.sb.from("route_votes").select("route_id").match({ route_id: routeId, user_id: u.id, kind }));
      if (existing.length) this.chk(await this.sb.from("route_votes").delete().match({ route_id: routeId, user_id: u.id, kind }));
      else this.chk(await this.sb.from("route_votes").insert({ route_id: routeId, user_id: u.id, kind }));
    }
    async listReviews(routeId) {
      const rows = this.chk(await this.sb.from("reviews").select("*, profiles(display_name)").eq("route_id", routeId).order("created_at", { ascending: false }));
      return rows.map((r) => ({ ...r, user_name: r.profiles?.display_name || "Commuter" }));
    }
    async addReview(routeId, { rating, comment }) {
      const u = this.need();
      this.chk(await this.sb.from("reviews").upsert({ route_id: routeId, user_id: u.id, rating, comment, created_at: now() }, { onConflict: "route_id,user_id" }));
    }
    async listAlerts({ routeId } = {}) {
      let q = this.sb.from("alerts").select("*, profiles(display_name)").gte("created_at", new Date(Date.now() - 48 * 3600e3).toISOString()).order("created_at", { ascending: false }).limit(100);
      if (routeId) q = q.eq("route_id", routeId);
      return this.chk(await q).map((a) => ({ ...a, user_name: a.profiles?.display_name || "Commuter" }));
    }
    async postAlert(a) { const u = this.need(); this.chk(await this.sb.from("alerts").insert({ ...a, user_id: u.id })); }
    async listSaved() {
      const u = this.need();
      const ids = this.chk(await this.sb.from("saved_routes").select("route_id").eq("user_id", u.id)).map((r) => r.route_id);
      if (!ids.length) return [];
      return this.decorate(this.chk(await this.sb.from("route_stats").select("*").in("id", ids)));
    }
    async isSaved(routeId) {
      if (!this.user) return false;
      return this.chk(await this.sb.from("saved_routes").select("route_id").match({ user_id: this.user.id, route_id: routeId })).length > 0;
    }
    async toggleSave(routeId) {
      const u = this.need();
      if (await this.isSaved(routeId)) { this.chk(await this.sb.from("saved_routes").delete().match({ user_id: u.id, route_id: routeId })); return false; }
      this.chk(await this.sb.from("saved_routes").insert({ user_id: u.id, route_id: routeId })); return true;
    }
    async leaderboard() {
      return this.chk(await this.sb.from("leaderboard").select("*").limit(50));
    }
    async adminQueue() {
      const rows = this.chk(await this.sb.from("route_stats").select("*").order("created_at", { ascending: false }).limit(300));
      return { pending: rows.filter((r) => r.status === "pending"), verified: rows.filter((r) => r.status === "verified"), flagged: rows.filter((r) => r.status === "flagged") };
    }
    async setRouteStatus(routeId, status) { this.chk(await this.sb.rpc("set_route_status", { p_route_id: routeId, p_status: status })); await this.loadProfile(); }
    async sendContact(msg) { this.chk(await this.sb.from("contact_messages").insert(msg)); }
  }

  SG.createStore = function () {
    if (cfg.backend === "supabase") {
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
        console.warn("Supabase isn't configured; falling back to local demo mode.");
        return new LocalStore();
      }
      return new SupabaseStore();
    }
    return new LocalStore();
  };
})();
