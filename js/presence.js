/* ============================================================
   TALLENTEX — PRESENCE SYSTEM (Supabase version)
   ============================================================
   Supabase Realtime's Presence feature tracks who is CURRENTLY
   connected via heartbeats, and fires a "leave" event automatically
   when a client disconnects (closed tab, lost network, crash) — this
   is what makes the "online now" list on admin pages actually live,
   without polling.

   The public.presence TABLE is used only for a slower, persisted
   "Last Seen" timestamp (so an offline user still shows a sensible
   last-seen time on the Users page). Note the honest limitation: the
   table update on logout relies on a best-effort browser event
   (visibilitychange/beforeunload), which is NOT as reliable as the
   realtime channel's own disconnect detection — a crashed tab may
   leave a stale "online" row in the table for a short time, even
   though the realtime presence list (used for the live "online now"
   count) already correctly shows them gone.
   ============================================================ */

let presenceChannel = null;
let presenceState = {}; // uid -> { name }

function startPresence(uid, displayName) {
  if (!uid) return;

  Tallentex.sb.from("presence").upsert({ user_id: uid, state: "online", last_active: Tallentex.nowIso() }).then(() => {});

  presenceChannel = Tallentex.sb.channel("presence:global", { config: { presence: { key: uid } } });

  presenceChannel
    .on("presence", { event: "sync" }, () => {
      presenceState = presenceChannel.presenceState();
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({ name: displayName || null, online_at: Tallentex.nowIso() });
      }
    });

  const markOffline = () => {
    // Best-effort only — see the caveat in the file header comment.
    navigator.sendBeacon && navigator.sendBeacon; // no-op placeholder for clarity
    Tallentex.sb.from("presence").upsert({ user_id: uid, state: "offline", last_active: Tallentex.nowIso() });
  };
  window.addEventListener("beforeunload", markOffline);
  document.addEventListener("visibilitychange", () => { if (document.hidden) markOffline(); });
}

function stopPresence(uid) {
  if (!uid) return;
  if (presenceChannel) {
    presenceChannel.untrack();
    Tallentex.sb.removeChannel(presenceChannel);
    presenceChannel = null;
  }
  Tallentex.sb.from("presence").upsert({ user_id: uid, state: "offline", last_active: Tallentex.nowIso() });
}

/* Admin helper: subscribe to the live "who's online right now" list. */
function watchAllPresence(callback) {
  const channel = Tallentex.sb.channel("presence:global-watch", { config: { presence: { key: "watcher" } } });
  channel
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const map = {};
      Object.keys(state).forEach((uid) => { map[uid] = { state: "online" }; });
      callback(map);
    })
    .subscribe();
  return channel;
}
