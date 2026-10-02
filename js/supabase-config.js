/* ============================================================
   TALLENTEX — SUPABASE CONFIGURATION
   ============================================================
   1. Go to https://supabase.com/dashboard → your project →
      Project Settings → API.
   2. Copy "Project URL" and the "anon public" key (NOT the
      "service_role" key — that one must never appear in any
      frontend file, ever).
   3. Paste them below.
   ============================================================ */

const SUPABASE_URL = "https://wujgwjuowlhfolshyqxz.supabase.co";       // e.g. https://xxxxx.supabase.co
const SUPABASE_ANON_KEY = "sb_publishable_AgGyflzfISp_S9LXlgnTfg_k1TQERoJ";

// `supabase` here is the global UMD export from the CDN script tag
// loaded before this file in every HTML page.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Shared handle + small helpers used across every page.
const Tallentex = {
  sb,
  nowIso: () => new Date().toISOString(),
  currentUserProfile: null
};