/* ============================================================
   TALLENTEX — STUDENT DASHBOARD LOGIC (Supabase version)
   ============================================================ */

async function loadDashboard(profile) {
  const nameEl = document.getElementById("welcome-name");
  if (nameEl) nameEl.textContent = profile.name || profile.email;

  const listEl = document.getElementById("available-tests-list");
  listEl.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading tests…</div>`;

  try {
    const nowIso = Tallentex.nowIso();
    const { data: rows, error } = await Tallentex.sb
      .from("tests")
      .select("*, test_subjects(subject_name, question_count)")
      .eq("status", "published")
      .or(`start_at.is.null,start_at.lte.${nowIso}`)
      .or(`end_at.is.null,end_at.gte.${nowIso}`)
      .limit(50);
    if (error) throw error;

    const tests = (rows || []).filter((t) => accessAllowsUser(t, profile))
      .map((t) => ({ ...t, totalQuestions: (t.test_subjects || []).reduce((s, x) => s + x.question_count, 0) }));

    if (tests.length === 0) {
      listEl.innerHTML = `<div class="state-block"><h3>No tests available right now</h3><p>Check back later — your administrator publishes new tests here.</p></div>`;
    } else {
      listEl.innerHTML = "";
      tests.slice(0, 4).forEach((t) => listEl.appendChild(renderTestCard(t)));
    }
    document.getElementById("stat-available").textContent = tests.length;
  } catch (err) {
    console.error(err);
    listEl.innerHTML = `<div class="state-block error-block"><h3>Couldn't load tests</h3><p>${err.message}</p></div>`;
  }

  try {
    const { data: attempts } = await Tallentex.sb.from("attempts").select("status").eq("user_id", profile.uid);
    let completed = 0, inProgress = 0;
    (attempts || []).forEach((a) => { a.status === "completed" ? completed++ : inProgress++; });
    document.getElementById("stat-completed").textContent = completed;
    document.getElementById("stat-inprogress").textContent = inProgress;
  } catch (err) { console.error(err); }

  try {
    const { data: results } = await Tallentex.sb.from("results").select("*").eq("user_id", profile.uid).order("submit_time", { ascending: false }).limit(1);
    const perfEl = document.getElementById("performance-snapshot");
    if (!results || results.length === 0) {
      perfEl.innerHTML = `<div class="state-block"><h3>No results yet</h3><p>Complete a test to see your performance here.</p></div>`;
    } else {
      const r = results[0];
      perfEl.innerHTML = `
        <div class="flex-between"><span class="text-muted">Latest score</span><strong>${r.score} / ${r.total_questions * r.marks_per_question}</strong></div>
        <div class="flex-between mt-8"><span class="text-muted">Percentage</span><strong>${Number(r.percentage).toFixed(1)}%</strong></div>
        <div class="flex-between mt-8"><span class="text-muted">Correct / Wrong</span><strong>${r.correct} / ${r.wrong}</strong></div>`;
    }
  } catch (err) { console.error(err); }
}

function renderTestCard(t) {
  const el = document.createElement("div");
  el.className = "card test-card";
  const subjectTags = (t.test_subjects || []).map(s => `<span class="subject-tag">${s.subject_name} · ${s.question_count}</span>`).join("");
  el.innerHTML = `
    <div class="flex-between">
      <h3>${t.name}</h3>
      <span class="badge badge-amber">${t.time_limit} min</span>
    </div>
    <p style="margin:0;">${t.description || ""}</p>
    <div class="subject-tags">${subjectTags}</div>
    <div class="test-meta">
      <span>📄 ${t.totalQuestions} questions</span>
      <span>✅ +${t.correct_marks}</span>
      <span>❌ -${t.negative_marks}</span>
    </div>
    <a href="tests.html?open=${t.id}" class="btn btn-primary btn-block">View Test</a>`;
  return el;
}

document.addEventListener("DOMContentLoaded", () => {
  requireAuth((profile) => {
    renderAppShell("dashboard", profile);
    loadDashboard(profile);
  });
});
