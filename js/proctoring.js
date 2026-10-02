/* ============================================================
   TALLENTEX — CONSENT-BASED EXAM PROCTORING (Supabase version)
   ============================================================
   DESIGN PRINCIPLES (do not remove these when extending this file):
   1. The student is shown an in-quiz consent screen and must click
      "Allow & Start Test" before the camera is ever requested —
      account-level consent at signup is necessary but not treated
      as sufficient on its own.
   2. Whenever the camera is active, a small "🔴 Recording" badge is
      visibly rendered on screen. This is intentional, not a bug.
   3. Periodic snapshots (not continuous video) are captured and
      uploaded to the private "proctoring" Storage bucket, whose
      policies (see supabase-schema.sql) only let a student write
      into their OWN in-progress attempt's folder, and only admins
      read them back.
   ============================================================ */

let proctorState = {
  stream: null,
  intervalId: null,
  attemptId: null,
  uid: null,
  snapshotEvery: 25000 // ms between snapshots — tune in one place
};

function requestProctoringConsent() {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop open";
    backdrop.innerHTML = `
      <div class="modal" style="max-width:460px;">
        <h3>Camera check before you begin</h3>
        <p>This test uses periodic camera snapshots (not continuous video) to help maintain exam integrity. A small recording indicator will stay visible on screen the whole time your camera is active. Snapshots are only reviewed if something looks unusual (e.g. repeated tab-switching).</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="proctor-decline">Cancel Test</button>
          <button class="btn btn-primary" id="proctor-allow">Allow &amp; Start Test</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    backdrop.querySelector("#proctor-decline").onclick = () => { backdrop.remove(); resolve(false); };
    backdrop.querySelector("#proctor-allow").onclick = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
        proctorState.stream = stream;
        backdrop.remove();
        resolve(true);
      } catch (err) {
        UI.toast("Camera access is required to start this test: " + err.message, "error", 7000);
        backdrop.remove();
        resolve(false);
      }
    };
  });
}

function renderRecordingBadge() {
  let badge = document.getElementById("proctor-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "proctor-badge";
    badge.style.cssText = "position:fixed;bottom:16px;left:16px;background:rgba(16,24,43,0.85);color:#fff;padding:6px 12px;border-radius:100px;font-size:0.75rem;font-weight:700;display:flex;align-items:center;gap:6px;z-index:500;";
    badge.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#e5484d;animation:proctor-pulse 1.2s infinite;"></span> Recording (exam integrity)`;
    const style = document.createElement("style");
    style.textContent = "@keyframes proctor-pulse{50%{opacity:0.3;}}";
    document.head.appendChild(style);
    document.body.appendChild(badge);
  }
}

function removeRecordingBadge() {
  const badge = document.getElementById("proctor-badge");
  if (badge) badge.remove();
}

async function startProctoring(attemptId, uid) {
  proctorState.attemptId = attemptId;
  proctorState.uid = uid;
  renderRecordingBadge();

  const video = document.createElement("video");
  video.srcObject = proctorState.stream;
  video.muted = true;
  video.style.display = "none";
  document.body.appendChild(video);
  await video.play().catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = 320; canvas.height = 240;

  async function captureSnapshot() {
    try {
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.6));
      if (!blob) return;
      const path = `${attemptId}/${Date.now()}.jpg`;
      const { error } = await Tallentex.sb.storage.from("proctoring").upload(path, blob, { contentType: "image/jpeg" });
      if (error) console.warn("Snapshot upload failed:", error.message);
    } catch (err) {
      console.warn("Snapshot capture failed:", err);
    }
  }

  captureSnapshot(); // one immediately, so a very short test still has coverage
  proctorState.intervalId = setInterval(captureSnapshot, proctorState.snapshotEvery);

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("blur", onWindowBlur);

  proctorState._video = video;
}

async function logViolation(type) {
  if (!proctorState.attemptId) return;
  try {
    await Tallentex.sb.rpc("log_violation", { p_attempt_id: proctorState.attemptId, p_type: type });
  } catch (err) {
    console.warn("Could not log violation:", err);
  }
}
function onVisibilityChange() { if (document.hidden) logViolation("tab-hidden"); }
function onWindowBlur() { logViolation("window-blur"); }

function stopProctoring() {
  if (proctorState.intervalId) clearInterval(proctorState.intervalId);
  if (proctorState.stream) proctorState.stream.getTracks().forEach(t => t.stop());
  if (proctorState._video) proctorState._video.remove();
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("blur", onWindowBlur);
  removeRecordingBadge();
  proctorState = { stream: null, intervalId: null, attemptId: null, uid: null, snapshotEvery: proctorState.snapshotEvery };
}
