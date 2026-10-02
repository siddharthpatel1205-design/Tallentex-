/* ============================================================
   TALLENTEX — PWA: service-worker registration + "Install app" bar
   Included on every page (except the live quiz, so an exam is
   never interrupted).
   ============================================================ */
(() => {
  const ROOT = new URL("../", document.currentScript.src).href;   // site root, works from / and /admin/
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register(ROOT + "sw.js", { scope: ROOT }).catch(() => {});
    });
  }

  if (isStandalone || /quiz\.html$/.test(location.pathname)) return;
  try { if (sessionStorage.getItem("tx-install-dismissed")) return; } catch (e) {}

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  let deferredPrompt = null;

  function css() {
    if (document.getElementById("tx-install-css")) return;
    const s = document.createElement("style");
    s.id = "tx-install-css";
    s.textContent = `
      #tx-install-bar{position:fixed;top:0;left:0;right:0;z-index:1500;display:flex;align-items:center;gap:12px;
        padding:8px 14px;background:#1f3a8a;color:#fff;font:500 .9rem/1.3 Inter,system-ui,sans-serif;
        box-shadow:0 2px 10px rgba(0,0,0,.25)}
      #tx-install-bar img{width:34px;height:34px;border-radius:8px;background:#fff;flex:none}
      #tx-install-bar .tx-txt{flex:1;min-width:0}
      #tx-install-bar .tx-txt small{display:block;opacity:.8;font-weight:400;font-size:.78rem}
      #tx-install-bar button{border:0;cursor:pointer;border-radius:8px;font:600 .85rem Inter,system-ui,sans-serif}
      #tx-install-btn{background:#fff;color:#1f3a8a;padding:8px 14px}
      #tx-install-x{background:transparent;color:#fff;font-size:1.3rem!important;padding:2px 8px}
      body.tx-has-install-bar{padding-top:52px}`;
    document.head.appendChild(s);
  }

  function show(mode) {
    if (document.getElementById("tx-install-bar")) return;
    css();
    const bar = document.createElement("div");
    bar.id = "tx-install-bar";
    bar.innerHTML = `
      <img src="${ROOT}favicon.png" alt="">
      <div class="tx-txt">Install Tallentex app
        <small>${mode === "ios" ? "Tap Share ⬆️ then “Add to Home Screen”" : "Faster access, opens like a real app"}</small></div>
      ${mode === "ios" ? "" : '<button id="tx-install-btn">Install</button>'}
      <button id="tx-install-x" aria-label="Close">×</button>`;
    document.body.prepend(bar);
    document.body.classList.add("tx-has-install-bar");

    const close = () => {
      bar.remove(); document.body.classList.remove("tx-has-install-bar");
      try { sessionStorage.setItem("tx-install-dismissed", "1"); } catch (e) {}
    };
    bar.querySelector("#tx-install-x").onclick = close;
    const btn = bar.querySelector("#tx-install-btn");
    if (btn) btn.onclick = async () => {
      if (!deferredPrompt) return close();
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => {});
      deferredPrompt = null;
      close();
    };
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (document.body) show("native"); else document.addEventListener("DOMContentLoaded", () => show("native"));
  });
  window.addEventListener("appinstalled", () => {
    const bar = document.getElementById("tx-install-bar");
    if (bar) bar.remove();
    document.body.classList.remove("tx-has-install-bar");
  });

  if (isIOS) document.addEventListener("DOMContentLoaded", () => show("ios"));
})();
