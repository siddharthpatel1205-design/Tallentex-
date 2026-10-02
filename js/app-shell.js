/* ============================================================
   TALLENTEX — SHARED APP SHELL (Supabase version)
   Renders the sidebar / topbar / mobile bottom nav that every
   logged-in student page shares.
   ============================================================ */

/* Shared by dashboard.js and tests.js: decides if a student may see/open a test.
   Postgres schema keeps access flattened directly on the tests row as
   access_type + access_values (text[]), instead of a nested object. */
function accessAllowsUser(test, profile) {
  const type = test.access_type || "all";
  const values = test.access_values || [];
  if (type === "all") return true;
  if (type === "selected") return values.includes(profile.uid);
  if (type === "class") return values.includes(profile.class);
  if (type === "group") return values.includes(profile.group);
  return false;
}

const NAV_ITEMS = [
  { href: "dashboard.html", icon: "🏠", label: "Dashboard", key: "dashboard" },
  { href: "tests.html", icon: "📝", label: "Available Tests", key: "tests" },
  { href: "history.html", icon: "📊", label: "Test History", key: "history" },
  { href: "profile.html", icon: "👤", label: "Profile", key: "profile" }
];

function renderAppShell(activeKey, profile) {
  const sidebar = document.getElementById("sidebar-mount");
  const bottomNav = document.getElementById("bottomnav-mount");
  const presence = document.getElementById("header-presence-mount");

  if (sidebar) {
    sidebar.innerHTML = `
      <div class="brand"><span class="mark">TX</span><span>Tallentex</span></div>
      <nav>
        ${NAV_ITEMS.map(i => `<a href="${i.href}" class="${i.key === activeKey ? "active" : ""}"><span class="icon">${i.icon}</span>${i.label}</a>`).join("")}
      </nav>
      <div class="sidebar-footer">
        <a href="#" id="logout-link" style="color:rgba(255,255,255,0.7);">🚪 Logout</a>
      </div>`;
    sidebar.querySelector("#logout-link").addEventListener("click", handleLogout);
  }

  if (bottomNav) {
    bottomNav.innerHTML = `
      <ul>
        ${NAV_ITEMS.map(i => `<li><a href="${i.href}" class="${i.key === activeKey ? "active" : ""}"><span class="icon">${i.icon}</span>${i.label}</a></li>`).join("")}
      </ul>`;
  }

  if (presence && profile) {
    presence.innerHTML = `<span class="text-muted" style="font-size:0.85rem;">${profile.name || profile.email}</span>
      <button id="header-logout-btn" class="btn btn-ghost btn-sm" style="padding:4px 8px;" title="Logout">🚪</button>`;
    presence.style.display = "flex";
    presence.style.alignItems = "center";
    presence.style.gap = "8px";
    presence.querySelector("#header-logout-btn").addEventListener("click", handleLogout);
  }
}

async function handleLogout(e) {
  if (e) e.preventDefault();
  const ok = await UI.confirmDialog({
    title: "Log out of Tallentex?",
    message: "You'll need to log in again to access your tests.",
    confirmLabel: "Log out"
  });
  if (!ok) return;
  if (Tallentex.currentUserProfile) stopPresence(Tallentex.currentUserProfile.uid);
  await Tallentex.sb.auth.signOut();
  window.location.href = "login.html";
}
