/* ============================================================
   TALLENTEX — SHARED UI UTILITIES (Supabase version)
   Toasts, confirm dialogs, and the blocking admin-message overlay.
   ============================================================ */

const UI = (() => {
  // Site root (works from / and /admin/) — used to find admin/admin-image.png
  const SITE_ROOT = new URL("../", document.currentScript.src).href;
  const ADMIN_AVATAR = SITE_ROOT + "admin/admin-image.png";
  const IMG_BUCKET = "message-images";

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------------- Image helpers (messages + replies) ---------------- */
  // Shrinks big phone photos to max 1280px JPEG so uploads are fast and cheap.
  function compressImage(file, maxDim = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) return reject(new Error("Please choose an image file."));
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process image."))), "image/jpeg", quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
      img.src = url;
    });
  }

  // folder = "admin" for admin messages, or the student's uid for replies
  async function uploadMessageImage(folder, file) {
    const blob = await compressImage(file);
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await Tallentex.sb.storage.from(IMG_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
    if (error) throw error;
    return path;
  }

  async function signedImageUrl(path) {
    if (!path) return null;
    const { data } = await Tallentex.sb.storage.from(IMG_BUCKET).createSignedUrl(path, 3600);
    return data ? data.signedUrl : null;
  }

  function openImageViewer(url) {
    const b = document.createElement("div");
    b.className = "modal-backdrop open"; b.style.zIndex = 2100;
    b.innerHTML = `<img src="${esc(url)}" style="max-width:96vw;max-height:92vh;border-radius:10px;background:#fff;" alt="">`;
    b.onclick = () => b.remove();
    document.body.appendChild(b);
  }

  function ensureToastRegion() {
    let region = document.getElementById("toast-region");
    if (!region) {
      region = document.createElement("div");
      region.id = "toast-region";
      region.setAttribute("aria-live", "polite");
      document.body.appendChild(region);
    }
    return region;
  }

  function toast(message, type = "info", duration = 4000) {
    const region = ensureToastRegion();
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    region.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  function confirmDialog({ title = "Are you sure?", message = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
    return new Promise((resolve) => {
      let backdrop = document.getElementById("confirm-backdrop");
      if (backdrop) backdrop.remove();

      backdrop = document.createElement("div");
      backdrop.id = "confirm-backdrop";
      backdrop.className = "modal-backdrop open";
      backdrop.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <h3>${title}</h3>
          <p>${message}</p>
          <div class="modal-actions">
            <button class="btn btn-secondary" data-action="cancel">${cancelLabel}</button>
            <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-action="confirm">${confirmLabel}</button>
          </div>
        </div>`;
      document.body.appendChild(backdrop);

      backdrop.querySelector('[data-action="cancel"]').onclick = () => { backdrop.remove(); resolve(false); };
      backdrop.querySelector('[data-action="confirm"]').onclick = () => { backdrop.remove(); resolve(true); };
      backdrop.addEventListener("click", (e) => { if (e.target === backdrop) { backdrop.remove(); resolve(false); } });
    });
  }

  function setLoading(button, isLoading, loadingText = "Please wait…") {
    if (!button) return;
    if (isLoading) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.innerHTML = `<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> ${loadingText}`;
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || button.textContent;
    }
  }

  function showFieldError(fieldEl, message) {
    fieldEl.classList.add("has-error");
    const err = fieldEl.querySelector(".error-text");
    if (err) err.textContent = message;
  }
  function clearFieldError(fieldEl) {
    fieldEl.classList.remove("has-error");
  }

  /* ---------------- Blocking admin-message popup ----------------
     Shows: admin's profile photo, the message (+ optional image) and two
     buttons — OK (acknowledge & close) and Reply (text + optional image,
     visible to the admin on Admin → Messages).
     Uses a Supabase Realtime channel on message_recipients; a one-time
     fetch on load also catches messages sent while the student was offline.
     Several pending messages are shown one after another. */
  function ensureBlockingOverlay() {
    let overlay = document.getElementById("blocking-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "blocking-overlay";
      overlay.className = "blocking-overlay";
      overlay.innerHTML = `
        <div class="blocking-card" role="alertdialog" aria-modal="true">
          <img class="admin-avatar" src="${ADMIN_AVATAR}" alt="Admin" />
          <div class="admin-name" id="blocking-from">Admin</div>
          <div class="label">MESSAGE FROM ADMIN</div>
          <p id="blocking-message-text"></p>
          <img id="blocking-message-img" class="blocking-img" alt="" style="display:none;" />
          <div id="blocking-actions" class="blocking-actions">
            <button id="blocking-reply-btn" class="btn btn-secondary">↩ Reply</button>
            <button id="blocking-ok-btn" class="btn btn-primary">OK</button>
          </div>
          <div id="blocking-reply-box" class="blocking-reply-box" style="display:none;">
            <textarea id="reply-text" placeholder="Type your reply…"></textarea>
            <div class="reply-attach">
              <label class="btn btn-ghost btn-sm" for="reply-file">📎 Attach image</label>
              <input id="reply-file" type="file" accept="image/*" style="display:none;" />
              <span id="reply-file-name" class="text-muted" style="font-size:0.8rem;"></span>
            </div>
            <img id="reply-preview" class="blocking-img" alt="" style="display:none;" />
            <div class="blocking-actions">
              <button id="reply-cancel-btn" class="btn btn-ghost">Back</button>
              <button id="reply-send-btn" class="btn btn-primary">Send reply</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  const queue = [];
  const seen = new Set();
  let showing = false;

  function enqueue(row) {
    if (!row || seen.has(row.id)) return;
    seen.add(row.id);
    queue.push(row);
    pump();
  }
  async function pump() {
    if (showing || queue.length === 0) return;
    showing = true;
    try { await showBlockingMessage(queue.shift()); } catch (e) { console.error(e); }
    showing = false;
    pump();
  }

  function showBlockingMessage(recipientRow) {
    return new Promise(async (resolve) => {
      const overlay = ensureBlockingOverlay();
      const $ = (id) => overlay.querySelector("#" + id);
      const textEl = $("blocking-message-text"), imgEl = $("blocking-message-img");
      const actions = $("blocking-actions"), replyBox = $("blocking-reply-box");
      const replyText = $("reply-text"), fileInput = $("reply-file");
      const preview = $("reply-preview"), fileName = $("reply-file-name");

      // reset state from any previous message
      replyBox.style.display = "none"; actions.style.display = "flex";
      replyText.value = ""; fileInput.value = ""; fileName.textContent = "";
      preview.style.display = "none"; imgEl.style.display = "none"; imgEl.onclick = null;

      const { data: msg } = await Tallentex.sb.from("messages").select("text, image_path, from_name").eq("id", recipientRow.message_id).single();
      textEl.textContent = msg ? (msg.text || "") : "(message unavailable)";
      textEl.style.display = textEl.textContent ? "" : "none";
      $("blocking-from").textContent = (msg && msg.from_name) || "Admin";
      if (msg && msg.image_path) {
        const url = await signedImageUrl(msg.image_path);
        if (url) { imgEl.src = url; imgEl.style.display = "block"; imgEl.onclick = () => openImageViewer(url); }
      }

      overlay.classList.add("open");
      document.body.style.overflow = "hidden";

      if (recipientRow.status === "pending") {
        await Tallentex.sb.from("message_recipients").update({ status: "delivered", received_at: Tallentex.nowIso() }).eq("id", recipientRow.id);
      }

      const acknowledgeAndClose = async () => {
        await Tallentex.sb.from("message_recipients").update({ status: "acknowledged", acknowledged_at: Tallentex.nowIso() }).eq("id", recipientRow.id);
        overlay.classList.remove("open");
        document.body.style.overflow = "";
        resolve();
      };

      $("blocking-ok-btn").onclick = acknowledgeAndClose;
      $("blocking-reply-btn").onclick = () => { actions.style.display = "none"; replyBox.style.display = "block"; replyText.focus(); };
      $("reply-cancel-btn").onclick = () => { replyBox.style.display = "none"; actions.style.display = "flex"; };

      fileInput.onchange = () => {
        const f = fileInput.files[0];
        if (!f) { preview.style.display = "none"; fileName.textContent = ""; return; }
        if (!f.type.startsWith("image/")) { UI.toast("Please choose an image file.", "error"); fileInput.value = ""; return; }
        fileName.textContent = f.name;
        preview.src = URL.createObjectURL(f); preview.style.display = "block";
      };

      $("reply-send-btn").onclick = async () => {
        const text = replyText.value.trim();
        const file = fileInput.files[0];
        if (!text && !file) { UI.toast("Write a reply or attach an image.", "error"); return; }
        const btn = $("reply-send-btn");
        setLoading(btn, true, "Sending…");
        try {
          const image_path = file ? await uploadMessageImage(recipientRow.user_id, file) : null;
          const { error } = await Tallentex.sb.from("message_replies").insert({
            message_id: recipientRow.message_id, user_id: recipientRow.user_id, text, image_path
          });
          if (error) throw error;
          UI.toast("Reply sent to admin.", "success");
          setLoading(btn, false);
          await acknowledgeAndClose();
        } catch (err) {
          setLoading(btn, false);
          UI.toast("Couldn't send reply: " + (err.message || err), "error", 6000);
        }
      };
    });
  }

  async function initBlockingMessages(uid) {
    if (!uid) return;

    const { data: pending } = await Tallentex.sb.from("message_recipients")
      .select("*").eq("user_id", uid).neq("status", "acknowledged")
      .order("id", { ascending: true });
    (pending || []).forEach(enqueue);

    Tallentex.sb.channel(`messages-${uid}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_recipients", filter: `user_id=eq.${uid}` },
        (payload) => enqueue(payload.new))
      .subscribe();
  }

  return { toast, confirmDialog, setLoading, showFieldError, clearFieldError, initBlockingMessages,
           esc, compressImage, uploadMessageImage, signedImageUrl, openImageViewer, ADMIN_AVATAR };
})();
