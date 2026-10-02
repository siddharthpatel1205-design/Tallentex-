/* ============================================================
   TALLENTEX — ADMIN PANEL LOGIC (Supabase version)
   ============================================================ */

const ADMIN_NAV_ITEMS = [
  { href: "dashboard.html", icon: "📊", label: "Dashboard", key: "dashboard" },
  { href: "users.html", icon: "👥", label: "Users", key: "users" },
  { href: "tests.html", icon: "🗂️", label: "Tests", key: "tests" },
  { href: "questions.html", icon: "❓", label: "Question Bank", key: "questions" },
  { href: "ai-generator.html", icon: "✨", label: "AI Generator", key: "ai" },
  { href: "live-monitor.html", icon: "🟢", label: "Live Monitor", key: "live" },
  { href: "messages.html", icon: "💬", label: "Messages", key: "messages" },
  { href: "results.html", icon: "🏆", label: "Results", key: "results" },
  { href: "settings.html", icon: "⚙️", label: "Settings", key: "settings" }
];

function renderAdminShell(activeKey, profile) {
  const sidebar = document.getElementById("admin-sidebar-mount");
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="brand"><span class="mark">TX</span><div><span>Tallentex</span><small>ADMIN PANEL</small></div></div>
      <nav>${ADMIN_NAV_ITEMS.map(i => `<a href="${i.href}" class="${i.key === activeKey ? "active" : ""}"><span class="icon">${i.icon}</span>${i.label}</a>`).join("")}</nav>
      <div class="sidebar-footer">
        <div class="text-muted" style="font-size:0.75rem;color:rgba(255,255,255,0.55);margin-bottom:8px;">${profile.name || profile.email}</div>
        <a href="#" id="admin-logout-link" style="color:rgba(255,255,255,0.7);">🚪 Logout</a>
      </div>`;
    sidebar.querySelector("#admin-logout-link").addEventListener("click", doAdminLogout);
  }

  subscribeAdminReplies(profile);

  // The sidebar (and its Logout link) is hidden on mobile widths, so every
  // admin page also gets a small always-visible logout button in the header.
  const header = document.querySelector(".admin-header");
  if (header && !header.querySelector("#admin-header-logout-btn")) {
    const btn = document.createElement("button");
    btn.id = "admin-header-logout-btn";
    btn.className = "btn btn-ghost btn-sm";
    btn.title = "Logout";
    btn.textContent = "🚪 Logout";
    btn.addEventListener("click", doAdminLogout);
    header.appendChild(btn);
  }
}

let adminRepliesSubscribed = false;
function subscribeAdminReplies() {
  if (adminRepliesSubscribed) return;
  adminRepliesSubscribed = true;
  Tallentex.sb.channel("admin-new-replies")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_replies" }, async (payload) => {
      const { data: u } = await Tallentex.sb.from("profiles").select("name").eq("id", payload.new.user_id).single();
      UI.toast(`💬 New reply from ${(u && u.name) || "a student"}${payload.new.image_path ? " (with image)" : ""}`, "info", 7000);
      document.dispatchEvent(new CustomEvent("tx-new-reply"));
    })
    .subscribe();
}

async function doAdminLogout(e) {
  if (e) e.preventDefault();
  const ok = await UI.confirmDialog({ title: "Log out?", confirmLabel: "Log out" });
  if (!ok) return;
  if (Tallentex.currentUserProfile) stopPresence(Tallentex.currentUserProfile.uid);
  await Tallentex.sb.auth.signOut();
  window.location.href = "index.html";
}

function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/* ============================================================
   ADMIN LOGIN (admin/index.html)
   ============================================================ */
function initAdminLogin() {
  const form = document.getElementById("admin-login-form");
  if (!form) return;
  // Already signed in as admin? Skip the login screen.
  Tallentex.sb.auth.getSession().then(async ({ data: { session } }) => {
    if (!session) return;
    const { data: p } = await Tallentex.sb.from("profiles").select("role").eq("id", session.user.id).single();
    if (p && p.role === "admin") window.location.replace("dashboard.html");
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    UI.setLoading(btn, true, "Signing in…");
    try {
      const { data: signInData, error } = await Tallentex.sb.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
      if (error) throw error;
      const { data: profile } = await Tallentex.sb.from("profiles").select("role").eq("id", signInData.user.id).single();
      if (!profile || profile.role !== "admin") {
        await Tallentex.sb.auth.signOut();
        throw { message: "not-admin" };
      }
      await offerSavePassword(form.email.value.trim(), form.password.value);
      window.location.href = "dashboard.html";
    } catch (err) {
      UI.setLoading(btn, false);
      UI.toast(err.message === "not-admin" ? "This account does not have admin access." : friendlyAuthError(err), "error", 6000);
    }
  });
}

/* ============================================================
   DASHBOARD (admin/dashboard.html)
   ============================================================ */
async function initAdminDashboard(profile) {
  renderAdminShell("dashboard", profile);

  const { count: userCount } = await Tallentex.sb.from("profiles").select("*", { count: "exact", head: true }).eq("role", "student");
  document.getElementById("stat-total-users").textContent = userCount ?? 0;

  const { count: testCount } = await Tallentex.sb.from("tests").select("*", { count: "exact", head: true }).eq("status", "published");
  document.getElementById("stat-available-tests").textContent = testCount ?? 0;

  const { count: resultCount } = await Tallentex.sb.from("results").select("*", { count: "exact", head: true });
  document.getElementById("stat-completed-tests").textContent = resultCount ?? 0;

  watchAllPresence((presence) => {
    document.getElementById("stat-online-now").textContent = Object.keys(presence).length;
  });

  async function refreshTestingCount() {
    const { count } = await Tallentex.sb.from("attempts").select("*", { count: "exact", head: true }).eq("status", "in-progress");
    document.getElementById("stat-currently-testing").textContent = count ?? 0;
  }
  refreshTestingCount();
  Tallentex.sb.channel("admin-dashboard-attempts")
    .on("postgres_changes", { event: "*", schema: "public", table: "attempts" }, refreshTestingCount)
    .subscribe();
}

/* ============================================================
   USERS (admin/users.html)
   ============================================================ */
async function initUsersPage(profile) {
  renderAdminShell("users", profile);
  const tbody = document.getElementById("users-tbody");
  const searchInput = document.getElementById("user-search");

  let allUsers = [];
  let presenceMap = {};

  async function load() {
    tbody.innerHTML = `<tr><td colspan="7"><div class="loading-row"><div class="spinner"></div> Loading users…</div></td></tr>`;
    const { data, error } = await Tallentex.sb.from("profiles").select("*").eq("role", "student").order("created_at", { ascending: false });
    if (error) { tbody.innerHTML = `<tr><td colspan="7">${error.message}</td></tr>`; return; }
    allUsers = data || [];
    render();
  }

  function render() {
    const q = (searchInput.value || "").toLowerCase();
    const filtered = allUsers.filter(u =>
      !q || (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q) || (u.mobile || "").includes(q));

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="state-block"><h3>No users found</h3></div></td></tr>`;
      return;
    }
    tbody.innerHTML = filtered.map(u => {
      const isOnline = !!presenceMap[u.id];
      return `
      <tr>
        <td>${u.name || "—"}</td>
        <td>${u.email}</td>
        <td>${u.mobile || "—"}</td>
        <td>${u.class || "—"}</td>
        <td>${fmtDate(u.created_at)}</td>
        <td><span class="presence-dot ${isOnline ? "online" : "offline"}"></span>${isOnline ? "Online" : "Offline"}</td>
        <td><button class="btn btn-secondary btn-sm" data-uid="${u.id}">View</button></td>
      </tr>`;
    }).join("");

    tbody.querySelectorAll("[data-uid]").forEach(btn => btn.addEventListener("click", () => openUserDetail(btn.dataset.uid)));
  }

  async function openUserDetail(uid) {
    const u = allUsers.find(x => x.id === uid);
    const { data: results } = await Tallentex.sb.from("results").select("*").eq("user_id", uid);
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop open";
    backdrop.innerHTML = `
      <div class="modal" style="max-width:520px;">
        <h3>${u.name}</h3>
        <p class="text-muted">${u.email} · ${u.mobile || "—"} · Class ${u.class || "—"}</p>
        <p><strong>Father's Name:</strong> ${u.father_name || "—"} &nbsp; <strong>School:</strong> ${u.school_name || "—"} &nbsp; <strong>Board:</strong> ${u.board || "—"}</p>
        <h3 class="mt-16" style="font-size:1rem;">Results (${(results || []).length})</h3>
        <div style="max-height:200px;overflow-y:auto;">
          ${(results || []).map(r => `<div class="flex-between" style="padding:8px 0;border-top:1px solid var(--line);"><span>${r.test_name}</span><strong>${r.score} (${Number(r.percentage).toFixed(0)}%)</strong></div>`).join("") || "<p class='text-muted'>No attempts yet.</p>"}
        </div>
        <div class="modal-actions"><button class="btn btn-secondary" id="close-user-modal">Close</button></div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector("#close-user-modal").onclick = () => backdrop.remove();
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
  }

  searchInput.addEventListener("input", render);
  watchAllPresence((p) => { presenceMap = p; render(); });
  await load();
}

/* ============================================================
   TESTS — create/edit/publish (admin/tests.html)
   ============================================================ */
async function initTestsPage(profile) {
  renderAdminShell("tests", profile);
  const listEl = document.getElementById("admin-tests-list");
  const modal = document.getElementById("test-modal");
  const form = document.getElementById("test-form");
  const subjectRows = document.getElementById("subject-rows");

  function addSubjectRow(name = "", count = "") {
    const row = document.createElement("div");
    row.className = "subject-row";
    row.innerHTML = `
      <div class="field" style="margin:0;"><label>Subject</label><input class="subj-name" value="${name}" placeholder="e.g. Mathematics" /></div>
      <div class="field" style="margin:0;"><label>Count</label><input class="subj-count" type="number" min="1" value="${count}" /></div>
      <button type="button" class="btn btn-ghost btn-sm remove-subject-row">✕</button>`;
    row.querySelector(".remove-subject-row").addEventListener("click", () => { row.remove(); refreshSubjectDatalist(); });
    row.querySelector(".subj-name").addEventListener("input", refreshSubjectDatalist);
    subjectRows.appendChild(row);
    refreshSubjectDatalist();
  }
  document.getElementById("add-subject-row").addEventListener("click", () => addSubjectRow());

  // ---- Inline "Add Questions Now" ----
  let pendingQuestions = [];

  function refreshSubjectDatalist() {
    const list = document.getElementById("iq-subject-list");
    const names = Array.from(subjectRows.children).map(r => r.querySelector(".subj-name").value.trim()).filter(Boolean);
    list.innerHTML = names.map(n => `<option value="${n}"></option>`).join("");
  }

  function renderPendingQuestions() {
    const el = document.getElementById("iq-pending-list");
    if (pendingQuestions.length === 0) { el.innerHTML = `<p class="text-muted">No questions added yet — this is fine, you can add them later.</p>`; return; }
    const letters = ["A", "B", "C", "D"];
    el.innerHTML = `<p class="hint">${pendingQuestions.length} question(s) ready to save with this test:</p>` +
      pendingQuestions.map((q, i) => `
        <div class="question-bank-item">
          <div class="q-top">
            <span class="badge badge-gray">${q.subject}</span>
            <button type="button" class="btn btn-danger btn-sm" data-remove-pending="${i}">Remove</button>
          </div>
          <p style="margin:8px 0 4px;font-weight:600;">${q.question_text}</p>
          <div class="q-opts">${[q.option_a, q.option_b, q.option_c, q.option_d].map((o, j) => `<div class="${j === q.correct_answer ? "correct" : ""}">${letters[j]}. ${o}</div>`).join("")}</div>
        </div>`).join("");
    el.querySelectorAll("[data-remove-pending]").forEach(btn => btn.addEventListener("click", () => {
      pendingQuestions.splice(parseInt(btn.dataset.removePending, 10), 1);
      renderPendingQuestions();
    }));
  }

  document.getElementById("iq-add-btn").addEventListener("click", () => {
    const subject = document.getElementById("iq-subject").value.trim();
    const questionText = document.getElementById("iq-question").value.trim();
    const a = document.getElementById("iq-a").value.trim();
    const b = document.getElementById("iq-b").value.trim();
    const c = document.getElementById("iq-c").value.trim();
    const d = document.getElementById("iq-d").value.trim();
    const validSubjects = Array.from(subjectRows.children).map(r => r.querySelector(".subj-name").value.trim());

    if (!validSubjects.includes(subject)) { UI.toast("Subject must exactly match one of the subjects listed above.", "error"); return; }
    if (!questionText || !a || !b || !c || !d) { UI.toast("Please fill in the question and all 4 options.", "error"); return; }

    pendingQuestions.push({
      subject, question_text: questionText, option_a: a, option_b: b, option_c: c, option_d: d,
      correct_answer: parseInt(document.getElementById("iq-correct").value, 10),
      difficulty: document.getElementById("iq-difficulty").value,
      marks: parseFloat(form.correctMarks.value) || 4,
      negative_marks: parseFloat(form.negativeMarks.value) || 1
    });
    ["iq-question", "iq-a", "iq-b", "iq-c", "iq-d"].forEach(id => document.getElementById(id).value = "");
    renderPendingQuestions();
  });

  function openModal(test) {
    form.reset();
    subjectRows.innerHTML = "";
    pendingQuestions = [];
    renderPendingQuestions();
    if (test) {
      form.dataset.editId = test.id;
      form.name.value = test.name; form.description.value = test.description || "";
      form.testClass.value = test.class || ""; form.timeLimit.value = test.time_limit;
      form.correctMarks.value = test.correct_marks; form.negativeMarks.value = test.negative_marks;
      form.passingMarks.value = test.passing_marks || 0; form.maxAttempts.value = test.max_attempts || 1;
      form.randomizeQuestions.checked = !!test.randomize_questions;
      form.randomizeOptions.checked = !!test.randomize_options;
      form.showResultImmediately.checked = test.show_result_immediately !== false;
      form.allowReview.checked = !!test.allow_review;
      form.accessType.value = test.access_type || "all";
      form.accessValues.value = (test.access_values || []).join(", ");
      (test.test_subjects || []).forEach(s => addSubjectRow(s.subject_name, s.question_count));
    } else {
      delete form.dataset.editId;
      addSubjectRow();
    }
    modal.classList.add("open");
  }
  document.getElementById("new-test-btn").addEventListener("click", () => openModal(null));
  document.getElementById("close-test-modal").addEventListener("click", () => modal.classList.remove("open"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const subjects = Array.from(subjectRows.children).map(row => ({
      name: row.querySelector(".subj-name").value.trim(),
      count: parseInt(row.querySelector(".subj-count").value, 10) || 0
    })).filter(s => s.name && s.count > 0);

    if (subjects.length === 0) { UI.toast("Add at least one subject with a question count.", "error"); return; }

    const payload = {
      name: form.name.value.trim(),
      description: form.description.value.trim(),
      class: form.testClass.value.trim(),
      time_limit: parseInt(form.timeLimit.value, 10),
      correct_marks: parseFloat(form.correctMarks.value),
      negative_marks: parseFloat(form.negativeMarks.value),
      passing_marks: parseFloat(form.passingMarks.value) || 0,
      max_attempts: parseInt(form.maxAttempts.value, 10) || 1,
      randomize_questions: form.randomizeQuestions.checked,
      randomize_options: form.randomizeOptions.checked,
      show_result_immediately: form.showResultImmediately.checked,
      allow_review: form.allowReview.checked,
      access_type: form.accessType.value,
      access_values: form.accessValues.value.split(",").map(v => v.trim()).filter(Boolean)
    };

    const btn = form.querySelector('button[type="submit"]');
    UI.setLoading(btn, true, "Saving…");
    try {
      let testId = form.dataset.editId;
      if (testId) {
        const { error } = await Tallentex.sb.from("tests").update(payload).eq("id", testId);
        if (error) throw error;
        await Tallentex.sb.from("test_subjects").delete().eq("test_id", testId);
      } else {
        payload.status = "draft";
        payload.created_by = profile.uid;
        const { data, error } = await Tallentex.sb.from("tests").insert(payload).select().single();
        if (error) throw error;
        testId = data.id;
      }
      const subjectRowsPayload = subjects.map(s => ({ test_id: testId, subject_name: s.name, question_count: s.count }));
      const { error: subjErr } = await Tallentex.sb.from("test_subjects").insert(subjectRowsPayload);
      if (subjErr) throw subjErr;

      if (pendingQuestions.length > 0) {
        const questionRows = pendingQuestions.map(q => ({ ...q, class: payload.class, status: "approved", created_by: profile.uid }));
        const { error: qErr } = await Tallentex.sb.from("questions").insert(questionRows);
        if (qErr) throw qErr;
      }

      UI.toast(`Test saved as draft${pendingQuestions.length ? ` with ${pendingQuestions.length} question(s) added` : ""}.`, "success");
      modal.classList.remove("open");
      loadTestsList();
    } catch (err) {
      UI.toast("Couldn't save test: " + err.message, "error");
    } finally {
      UI.setLoading(btn, false);
    }
  });

  async function loadTestsList() {
    listEl.innerHTML = `<div class="loading-row"><div class="spinner"></div></div>`;
    const { data: tests, error } = await Tallentex.sb.from("tests").select("*, test_subjects(subject_name, question_count)").order("created_at", { ascending: false });
    if (error) { listEl.innerHTML = error.message; return; }
    if (!tests || tests.length === 0) { listEl.innerHTML = `<div class="state-block"><h3>No tests yet</h3><p>Create your first test to get started.</p></div>`; return; }
    listEl.innerHTML = "";
    tests.forEach(t => {
      const totalQuestions = (t.test_subjects || []).reduce((s, x) => s + x.question_count, 0);
      const card = document.createElement("div");
      card.className = "card test-card";
      card.innerHTML = `
        <div class="flex-between">
          <h3>${t.name}</h3>
          <span class="badge ${t.status === "published" ? "badge-green" : "badge-gray"}">${t.status}</span>
        </div>
        <p style="margin:0;">${t.description || ""}</p>
        <div class="test-meta">
          <span>📄 ${totalQuestions} questions</span>
          <span>⏱️ ${t.time_limit} min</span>
          <span>✅ +${t.correct_marks} / ❌ -${t.negative_marks}</span>
        </div>
        <div class="flex gap-8">
          <button class="btn btn-secondary btn-sm edit-btn">Edit</button>
          <button class="btn ${t.status === "published" ? "btn-secondary" : "btn-primary"} btn-sm toggle-publish-btn">${t.status === "published" ? "Unpublish" : "Publish"}</button>
          <button class="btn btn-danger btn-sm delete-btn">Delete</button>
        </div>`;
      card.querySelector(".edit-btn").addEventListener("click", () => openModal(t));
      card.querySelector(".toggle-publish-btn").addEventListener("click", async () => {
        await Tallentex.sb.from("tests").update({ status: t.status === "published" ? "draft" : "published" }).eq("id", t.id);
        loadTestsList();
      });
      card.querySelector(".delete-btn").addEventListener("click", async () => {
        const ok = await UI.confirmDialog({ title: `Delete "${t.name}"?`, message: "This cannot be undone.", danger: true, confirmLabel: "Delete" });
        if (!ok) return;
        await Tallentex.sb.from("tests").delete().eq("id", t.id);
        loadTestsList();
      });
      listEl.appendChild(card);
    });
  }

  await loadTestsList();
}

/* ============================================================
   QUESTION BANK (admin/questions.html)
   ============================================================ */
async function initQuestionsPage(profile) {
  renderAdminShell("questions", profile);
  const listEl = document.getElementById("question-list");
  const modal = document.getElementById("question-modal");
  const form = document.getElementById("question-form");
  let allQuestions = [];

  function openModal(q) {
    form.reset();
    if (q) {
      form.dataset.editId = q.id;
      form.subject.value = q.subject; form.topic.value = q.topic || "";
      form.qClass.value = q.class || ""; form.questionText.value = q.question_text;
      form.optA.value = q.option_a; form.optB.value = q.option_b;
      form.optC.value = q.option_c; form.optD.value = q.option_d;
      form.correctAnswer.value = q.correct_answer;
      form.marks.value = q.marks; form.negativeMarks.value = q.negative_marks;
      form.difficulty.value = q.difficulty || "medium";
      form.tags.value = (q.tags || []).join(", ");
      form.explanation.value = q.explanation || "";
    } else {
      delete form.dataset.editId;
    }
    modal.classList.add("open");
  }
  document.getElementById("new-question-btn").addEventListener("click", () => openModal(null));
  document.getElementById("close-question-modal").addEventListener("click", () => modal.classList.remove("open"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      subject: form.subject.value.trim(),
      topic: form.topic.value.trim(),
      class: form.qClass.value.trim(),
      question_text: form.questionText.value.trim(),
      option_a: form.optA.value.trim(), option_b: form.optB.value.trim(),
      option_c: form.optC.value.trim(), option_d: form.optD.value.trim(),
      correct_answer: parseInt(form.correctAnswer.value, 10),
      marks: parseFloat(form.marks.value) || 1,
      negative_marks: parseFloat(form.negativeMarks.value) || 0,
      difficulty: form.difficulty.value,
      tags: form.tags.value.split(",").map(t => t.trim()).filter(Boolean),
      explanation: form.explanation.value.trim(),
      status: "approved"
    };
    const btn = form.querySelector('button[type="submit"]');
    UI.setLoading(btn, true, "Saving…");
    try {
      if (form.dataset.editId) {
        const { error } = await Tallentex.sb.from("questions").update(payload).eq("id", form.dataset.editId);
        if (error) throw error;
      } else {
        payload.created_by = profile.uid;
        const { error } = await Tallentex.sb.from("questions").insert(payload);
        if (error) throw error;
      }
      UI.toast("Question saved.", "success");
      modal.classList.remove("open");
      loadQuestions();
    } catch (err) {
      UI.toast("Couldn't save question: " + err.message, "error");
    } finally {
      UI.setLoading(btn, false);
    }
  });

  function renderList() {
    const subjectFilter = document.getElementById("filter-subject").value;
    const classFilter = document.getElementById("filter-class").value;
    const difficultyFilter = document.getElementById("filter-difficulty").value;
    const q = document.getElementById("question-search").value.toLowerCase();

    const filtered = allQuestions.filter(item =>
      (!subjectFilter || item.subject === subjectFilter) &&
      (!classFilter || item.class === classFilter) &&
      (!difficultyFilter || item.difficulty === difficultyFilter) &&
      (!q || item.question_text.toLowerCase().includes(q)));

    if (filtered.length === 0) { listEl.innerHTML = `<div class="state-block"><h3>No questions match</h3></div>`; return; }

    const letters = ["A", "B", "C", "D"];
    listEl.innerHTML = filtered.map(item => {
      const opts = [item.option_a, item.option_b, item.option_c, item.option_d];
      return `
      <div class="question-bank-item">
        <div class="q-top">
          <div>
            <span class="badge badge-gray">${item.subject}</span>
            <span class="badge badge-gray">${item.class || "—"}</span>
            <span class="badge badge-amber">${item.difficulty}</span>
          </div>
          <div class="flex gap-8">
            <button class="btn btn-secondary btn-sm" data-edit="${item.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-del="${item.id}">Delete</button>
          </div>
        </div>
        <p style="margin:10px 0 4px;color:var(--ink);font-weight:600;">${item.question_text}</p>
        <div class="q-opts">
          ${opts.map((o, i) => `<div class="${i === item.correct_answer ? "correct" : ""}">${letters[i]}. ${o}</div>`).join("")}
        </div>
      </div>`;
    }).join("");

    listEl.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => openModal(allQuestions.find(x => x.id === btn.dataset.edit))));
    listEl.querySelectorAll("[data-del]").forEach(btn => btn.addEventListener("click", async () => {
      const ok = await UI.confirmDialog({ title: "Delete this question?", danger: true, confirmLabel: "Delete" });
      if (!ok) return;
      await Tallentex.sb.from("questions").delete().eq("id", btn.dataset.del);
      loadQuestions();
    }));
  }

  async function loadQuestions() {
    listEl.innerHTML = `<div class="loading-row"><div class="spinner"></div></div>`;
    const { data, error } = await Tallentex.sb.from("questions").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) { listEl.innerHTML = error.message; return; }
    allQuestions = data || [];
    renderList();
  }

  ["filter-subject", "filter-class", "filter-difficulty", "question-search"].forEach(id =>
    document.getElementById(id).addEventListener("input", renderList));

  // Import / Export uses the SAME external JSON shape as data/sample-questions.json
  // (camelCase, options[] array) — only translated to/from DB column names here.
  document.getElementById("export-json-btn").addEventListener("click", () => {
    const payload = {
      questions: allQuestions.map(q => ({
        subject: q.subject, topic: q.topic, class: q.class, question: q.question_text,
        options: [q.option_a, q.option_b, q.option_c, q.option_d],
        correctAnswer: q.correct_answer, marks: q.marks, negativeMarks: q.negative_marks,
        difficulty: q.difficulty, tags: q.tags, explanation: q.explanation
      }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tallentex-questions-export.json";
    a.click();
  });

  document.getElementById("import-json-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const items = parsed.questions || [];
      if (!Array.isArray(items) || items.length === 0) throw new Error("No questions found in file.");
      const ok = await UI.confirmDialog({ title: `Import ${items.length} questions?`, confirmLabel: "Import" });
      if (!ok) return;
      const rows = items.map(item => ({
        subject: item.subject, topic: item.topic, class: item.class, question_text: item.question,
        option_a: item.options[0], option_b: item.options[1], option_c: item.options[2], option_d: item.options[3],
        correct_answer: item.correctAnswer, marks: item.marks, negative_marks: item.negativeMarks,
        difficulty: item.difficulty, tags: item.tags || [], explanation: item.explanation,
        status: "approved", created_by: profile.uid
      }));
      const { error } = await Tallentex.sb.from("questions").insert(rows);
      if (error) throw error;
      UI.toast(`Imported ${items.length} questions.`, "success");
      loadQuestions();
    } catch (err) {
      UI.toast("Import failed: " + err.message, "error");
    } finally {
      e.target.value = "";
    }
  });

  await loadQuestions();
}

/* ============================================================
   AI QUESTION GENERATOR (admin/ai-generator.html)
   ============================================================
   No AI API key is ever placed here. Point this at a Supabase Edge
   Function URL that holds your AI provider's key server-side, e.g.
   "https://YOUR_PROJECT_REF.supabase.co/functions/v1/generate-questions"
   ============================================================ */
const AI_GENERATOR_ENDPOINT = ""; // <-- set this to your deployed Edge Function URL

async function initAIGeneratorPage(profile) {
  renderAdminShell("ai", profile);
  const form = document.getElementById("ai-generator-form");
  const resultsEl = document.getElementById("ai-generated-list");
  let generated = [];

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!AI_GENERATOR_ENDPOINT) {
      resultsEl.innerHTML = `<div class="state-block error-block"><h3>AI Generator isn't configured yet</h3><p>Set <code>AI_GENERATOR_ENDPOINT</code> in js/admin.js to a Supabase Edge Function that calls your AI provider. The secret API key must live only in that function's environment — never in this frontend file.</p></div>`;
      return;
    }
    const payload = {
      class: form.aiClass.value, subject: form.aiSubject.value, topic: form.aiTopic.value,
      difficulty: form.aiDifficulty.value, count: parseInt(form.aiCount.value, 10),
      marks: parseFloat(form.aiMarks.value), negativeMarks: parseFloat(form.aiNegativeMarks.value)
    };
    const btn = form.querySelector('button[type="submit"]');
    UI.setLoading(btn, true, "Generating…");
    try {
      const { data: sessionData } = await Tallentex.sb.auth.getSession();
      const res = await fetch(AI_GENERATOR_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session.access_token}` },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();
      generated = data.questions || [];
      renderGenerated();
    } catch (err) {
      resultsEl.innerHTML = `<div class="state-block error-block"><h3>Generation failed</h3><p>${err.message}</p></div>`;
    } finally {
      UI.setLoading(btn, false);
    }
  });

  function renderGenerated() {
    if (generated.length === 0) { resultsEl.innerHTML = `<p class="text-muted">No questions generated yet.</p>`; return; }
    const letters = ["A", "B", "C", "D"];
    resultsEl.innerHTML = generated.map((q, i) => `
      <div class="question-bank-item">
        <p style="font-weight:600;">${q.question}</p>
        <div class="q-opts">${q.options.map((o, j) => `<div class="${j === q.correctAnswer ? "correct" : ""}">${letters[j]}. ${o}</div>`).join("")}</div>
        <div class="flex gap-8 mt-8">
          <button class="btn btn-primary btn-sm" data-approve="${i}">Approve → Add to Bank</button>
          <button class="btn btn-danger btn-sm" data-reject="${i}">Discard</button>
        </div>
      </div>`).join("");

    resultsEl.querySelectorAll("[data-approve]").forEach(btn => btn.addEventListener("click", async () => {
      const q = generated[btn.dataset.approve];
      await Tallentex.sb.from("questions").insert({
        subject: q.subject, topic: q.topic, class: q.class, question_text: q.question,
        option_a: q.options[0], option_b: q.options[1], option_c: q.options[2], option_d: q.options[3],
        correct_answer: q.correctAnswer, marks: q.marks, negative_marks: q.negativeMarks,
        difficulty: q.difficulty, status: "approved", created_by: profile.uid
      });
      UI.toast("Added to question bank.", "success");
      btn.closest(".question-bank-item").remove();
    }));
    resultsEl.querySelectorAll("[data-reject]").forEach(btn => btn.addEventListener("click", () => btn.closest(".question-bank-item").remove()));
  }
}

/* ============================================================
   LIVE MONITOR (admin/live-monitor.html)
   ============================================================
   Postgres realtime pushes attempts table changes directly — no
   polling and no separate "live pointer" table needed, since the
   attempts row itself already carries current_question/answers and
   is updated on every student action in quiz.js.
   ============================================================ */
function initLiveMonitorPage(profile) {
  renderAdminShell("live", profile);
  const listEl = document.getElementById("live-users-list");

  async function refresh() {
    const { data: attempts, error } = await Tallentex.sb
      .from("attempts")
      .select("*, profiles(name), tests(name)")
      .eq("status", "in-progress");
    if (error) { listEl.innerHTML = error.message; return; }

    document.getElementById("live-count").textContent = (attempts || []).length;
    if (!attempts || attempts.length === 0) {
      listEl.innerHTML = `<div class="state-block"><h3>No one is currently taking a test</h3></div>`;
      return;
    }
    listEl.innerHTML = attempts.map(a => {
      const totalQuestions = (a.question_ids || []).length;
      const answered = Object.keys(a.answers || {}).length;
      const pct = totalQuestions ? Math.round((answered / totalQuestions) * 100) : 0;
      const started = a.start_time ? new Date(a.start_time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—";
      return `
      <div class="live-user-row">
        <div class="name-cell"><span class="presence-dot online"></span>${a.profiles ? a.profiles.name : a.user_id}</div>
        <div class="text-muted" style="font-size:0.85rem;">${a.tests ? a.tests.name : a.test_name}</div>
        <div class="text-muted" style="font-size:0.85rem;">Started ${started}</div>
        <div class="flex gap-8" style="align-items:center;">
          <div class="live-progress-bar"><span style="width:${pct}%;"></span></div>
          <span style="font-size:0.8rem;">${(a.current_question || 0) + 1}/${totalQuestions}</span>
        </div>
        <button class="btn btn-secondary btn-sm" data-message-uid="${a.user_id}" data-message-name="${a.profiles ? a.profiles.name : ""}">Message</button>
      </div>`;
    }).join("");

    listEl.querySelectorAll("[data-message-uid]").forEach(btn => btn.addEventListener("click", () => {
      window.location.href = `messages.html?to=${btn.dataset.messageUid}&name=${encodeURIComponent(btn.dataset.messageName)}`;
    }));
  }

  refresh();
  Tallentex.sb.channel("admin-live-monitor")
    .on("postgres_changes", { event: "*", schema: "public", table: "attempts" }, refresh)
    .subscribe();
}

/* ============================================================
   MESSAGES (admin/messages.html)
   ============================================================ */
async function initMessagesPage(profile) {
  renderAdminShell("messages", profile);
  const form = document.getElementById("message-form");
  const targetSelect = document.getElementById("message-target");
  const historyEl = document.getElementById("message-history");

  const { data: users } = await Tallentex.sb.from("profiles").select("id, name, email").eq("role", "student");
  targetSelect.innerHTML = `<option value="__all__">All Users</option>` +
    (users || []).map(u => `<option value="${u.id}">${u.name} (${u.email})</option>`).join("");

  const presetUid = new URLSearchParams(window.location.search).get("to");
  if (presetUid) targetSelect.value = presetUid;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = form.messageText.value.trim();
    const imageFile = form.messageImage.files[0];
    if (!text && !imageFile) { UI.toast("Write a message or attach an image.", "error"); return; }
    const target = targetSelect.value;
    const isGlobal = target === "__all__";
    const recipientIds = isGlobal ? (users || []).map(u => u.id) : [target];

    const btn = form.querySelector('button[type="submit"]');
    UI.setLoading(btn, true, "Sending…");
    try {
      const image_path = imageFile ? await UI.uploadMessageImage("admin", imageFile) : null;
      const { data: msg, error } = await Tallentex.sb.from("messages").insert({
        from_user: profile.uid, from_name: profile.name || "Admin", text, image_path, is_global: isGlobal,
        target_user: isGlobal ? null : target
      }).select().single();
      if (error) throw error;

      // Inserting these rows is itself the "delivery" mechanism — every
      // online student's browser is already subscribed (see ui-utils.js)
      // to postgres_changes INSERT events on their own recipient rows, so
      // the blocking popup appears instantly with no separate push needed.
      const recipientRows = recipientIds.map(uid => ({ message_id: msg.id, user_id: uid, status: "pending" }));
      const { error: recErr } = await Tallentex.sb.from("message_recipients").insert(recipientRows);
      if (recErr) throw recErr;

      UI.toast(`Message sent to ${recipientIds.length} user(s).`, "success");
      form.reset();
      loadHistory();
    } catch (err) {
      UI.toast("Couldn't send message: " + err.message, "error");
    } finally {
      UI.setLoading(btn, false);
    }
  });

  async function loadHistory() {
    historyEl.innerHTML = `<div class="loading-row"><div class="spinner"></div></div>`;
    const { data: messages, error } = await Tallentex.sb.from("messages").select("*").order("sent_at", { ascending: false }).limit(30);
    if (error) { historyEl.innerHTML = error.message; return; }
    if (!messages || messages.length === 0) { historyEl.innerHTML = `<div class="state-block"><h3>No messages sent yet</h3></div>`; return; }

    historyEl.innerHTML = "";
    const nameById = Object.fromEntries((users || []).map(u => [u.id, u.name || u.email]));
    for (const m of messages) {
      const { data: recipients } = await Tallentex.sb.from("message_recipients").select("status").eq("message_id", m.id);
      const { data: replies } = await Tallentex.sb.from("message_replies").select("*").eq("message_id", m.id).order("created_at", { ascending: true });
      const ackCount = (recipients || []).filter(r => r.status === "acknowledged").length;
      const pendingCount = (recipients || []).filter(r => r.status !== "acknowledged").length;
      const imgUrl = m.image_path ? await UI.signedImageUrl(m.image_path) : null;

      const repliesHtml = [];
      for (const r of (replies || [])) {
        const rUrl = r.image_path ? await UI.signedImageUrl(r.image_path) : null;
        repliesHtml.push(`
          <div class="reply-item">
            <div class="reply-meta"><strong>↩ ${UI.esc(nameById[r.user_id] || "Student")}</strong><span>${fmtDate(r.created_at)}</span></div>
            ${r.text ? `<div style="white-space:pre-wrap;">${UI.esc(r.text)}</div>` : ""}
            ${rUrl ? `<img src="${UI.esc(rUrl)}" alt="reply image" data-zoom="${UI.esc(rUrl)}">` : ""}
            <a href="messages.html?to=${r.user_id}" style="font-size:0.78rem;">Send a message back →</a>
          </div>`);
      }

      const row = document.createElement("div");
      row.className = "card mt-8";
      row.innerHTML = `
        <div class="flex-between"><strong>${m.is_global ? "All Users" : UI.esc(nameById[m.target_user] || "1 user")}</strong><span class="text-muted" style="font-size:0.8rem;">${fmtDate(m.sent_at)}</span></div>
        ${m.text ? `<p style="margin:6px 0;white-space:pre-wrap;">${UI.esc(m.text)}</p>` : ""}
        ${imgUrl ? `<img class="msg-thumb" src="${UI.esc(imgUrl)}" alt="message image" data-zoom="${UI.esc(imgUrl)}">` : ""}
        <div class="flex gap-12" style="font-size:0.82rem;">
          <span class="badge badge-green">✅ ${ackCount} acknowledged</span>
          <span class="badge badge-amber">⏳ ${pendingCount} pending</span>
          <span class="badge badge-gray">💬 ${(replies || []).length} replies</span>
        </div>
        ${repliesHtml.length ? `<div class="reply-thread">${repliesHtml.join("")}</div>` : ""}`;
      row.querySelectorAll("[data-zoom]").forEach(img => img.addEventListener("click", () => UI.openImageViewer(img.dataset.zoom)));
      historyEl.appendChild(row);
    }
  }
  await loadHistory();
  document.addEventListener("tx-new-reply", loadHistory);
}

/* ============================================================
   RESULTS (admin/results.html)
   ============================================================ */
async function initAdminResultsPage(profile) {
  renderAdminShell("results", profile);
  const tbody = document.getElementById("results-tbody");
  const searchInput = document.getElementById("result-search");
  let allResults = [];

  function render() {
    const q = (searchInput.value || "").toLowerCase();
    const filtered = allResults.filter(r => !q || (r.test_name || "").toLowerCase().includes(q) || (r.userName || "").toLowerCase().includes(q));
    if (filtered.length === 0) { tbody.innerHTML = `<tr><td colspan="8"><div class="state-block"><h3>No results found</h3></div></td></tr>`; return; }
    tbody.innerHTML = filtered.map(r => `
      <tr>
        <td>${r.userName || r.user_id}</td>
        <td>${r.test_name}</td>
        <td>${r.score}</td>
        <td>${Number(r.percentage).toFixed(1)}%</td>
        <td>${r.correct}/${r.wrong}/${r.unanswered}</td>
        <td>${fmtDate(r.submit_time)}</td>
        <td>${r.auto_submitted ? "Auto" : "Manual"}</td>
        <td><button class="btn btn-secondary btn-sm" data-proctor="${r.attempt_id}">View Proctoring</button></td>
      </tr>`).join("");
    tbody.querySelectorAll("[data-proctor]").forEach(btn => btn.addEventListener("click", () => openProctoringViewer(btn.dataset.proctor)));
  }

  async function openProctoringViewer(attemptId) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop open";
    backdrop.innerHTML = `<div class="modal" style="max-width:640px;max-height:85vh;overflow-y:auto;">
      <h3>Proctoring — Attempt ${attemptId}</h3>
      <div id="proctor-violations" class="mt-8"><div class="loading-row"><div class="spinner"></div></div></div>
      <div id="proctor-snapshots" class="grid grid-3 mt-16"></div>
      <div class="modal-actions"><button class="btn btn-secondary" id="close-proctor-modal">Close</button></div>
    </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector("#close-proctor-modal").onclick = () => backdrop.remove();
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });

    try {
      const { data: attempt } = await Tallentex.sb.from("attempts").select("violations").eq("id", attemptId).single();
      const violations = (attempt && attempt.violations) || [];
      const vEl = backdrop.querySelector("#proctor-violations");
      vEl.innerHTML = violations.length === 0
        ? `<span class="badge badge-green">No flagged violations</span>`
        : `<span class="badge badge-amber">${violations.length} flagged event(s)</span>
           <div class="mt-8" style="max-height:120px;overflow-y:auto;font-size:0.82rem;">${violations.map(v => `<div>${v.type} — ${new Date(v.at).toLocaleTimeString()}</div>`).join("")}</div>`;
    } catch (err) {
      backdrop.querySelector("#proctor-violations").innerHTML = `<p class="text-muted">Couldn't load violation log.</p>`;
    }

    try {
      const { data: files, error } = await Tallentex.sb.storage.from("proctoring").list(attemptId, { limit: 12, sortBy: { column: "created_at", order: "desc" } });
      const snapEl = backdrop.querySelector("#proctor-snapshots");
      if (error || !files || files.length === 0) {
        snapEl.innerHTML = `<p class="text-muted">No snapshots stored for this attempt.</p>`;
        return;
      }
      const paths = files.map(f => `${attemptId}/${f.name}`);
      const { data: signed } = await Tallentex.sb.storage.from("proctoring").createSignedUrls(paths, 60);
      snapEl.innerHTML = (signed || []).map(s => `<img src="${s.signedUrl}" style="width:100%;border-radius:8px;border:1px solid var(--line);" />`).join("");
    } catch (err) {
      backdrop.querySelector("#proctor-snapshots").innerHTML = `<p class="text-muted">Couldn't load snapshots.</p>`;
    }
  }

  const { data: results, error } = await Tallentex.sb.from("results").select("*").order("submit_time", { ascending: false }).limit(500);
  if (error) { tbody.innerHTML = error.message; return; }
  allResults = results || [];

  const uniqueUids = [...new Set(allResults.map(r => r.user_id))];
  if (uniqueUids.length > 0) {
    const { data: profiles } = await Tallentex.sb.from("profiles").select("id, name").in("id", uniqueUids);
    const nameMap = {};
    (profiles || []).forEach(p => { nameMap[p.id] = p.name; });
    allResults.forEach(r => r.userName = nameMap[r.user_id]);
  }

  document.getElementById("export-results-btn").addEventListener("click", () => {
    const rows = [["User", "Test", "Score", "Percentage", "Correct", "Wrong", "Unanswered", "Submitted"]];
    allResults.forEach(r => rows.push([r.userName, r.test_name, r.score, Number(r.percentage).toFixed(1), r.correct, r.wrong, r.unanswered, fmtDate(r.submit_time)]));
    const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "tallentex-results.csv"; a.click();
  });

  searchInput.addEventListener("input", render);
  render();
}

/* ============================================================
   SETTINGS (admin/settings.html)
   ============================================================ */
async function initSettingsPage(profile) {
  renderAdminShell("settings", profile);
  const form = document.getElementById("settings-form");
  const { data: s } = await Tallentex.sb.from("app_settings").select("*").eq("id", 1).single();
  form.appName.value = (s && s.app_name) || "Tallentex";
  form.supportEmail.value = (s && s.support_email) || "";
  form.defaultMaxAttempts.value = (s && s.default_max_attempts) || 1;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    UI.setLoading(btn, true, "Saving…");
    try {
      const { error } = await Tallentex.sb.from("app_settings").update({
        app_name: form.appName.value.trim(),
        support_email: form.supportEmail.value.trim(),
        default_max_attempts: parseInt(form.defaultMaxAttempts.value, 10) || 1,
        updated_at: Tallentex.nowIso()
      }).eq("id", 1);
      if (error) throw error;
      UI.toast("Settings saved.", "success");
    } catch (err) {
      UI.toast("Couldn't save settings: " + err.message, "error");
    } finally {
      UI.setLoading(btn, false);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initAdminLogin(); // no-op on pages without #admin-login-form
});
