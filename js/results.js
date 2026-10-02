/* ============================================================
   TALLENTEX — RESULT PAGE LOGIC (Supabase version)
   ============================================================ */

async function loadResult(profile) {
  const attemptId = new URLSearchParams(window.location.search).get("attempt");
  const root = document.getElementById("result-root");
  if (!attemptId) {
    root.innerHTML = `<div class="state-block error-block"><h3>No result specified</h3><a href="history.html" class="btn btn-primary">View Test History</a></div>`;
    return;
  }

  try {
    const { data: r, error } = await Tallentex.sb.from("results").select("*").eq("attempt_id", attemptId).single();
    if (error || !r) {
      root.innerHTML = `<div class="state-block"><h3>Result not ready yet</h3><p>If you just submitted, this can take a few seconds. Try refreshing.</p></div>`;
      return;
    }
    if (r.user_id !== profile.uid) {
      root.innerHTML = `<div class="state-block error-block"><h3>You don't have access to this result.</h3></div>`;
      return;
    }

    const passed = r.score >= (r.passing_marks || 0);
    root.innerHTML = `
      <div class="card text-center" style="max-width:560px;margin:0 auto;">
        <div class="badge ${passed ? "badge-green" : "badge-red"}" style="margin-bottom:10px;">${passed ? "PASSED" : "NOT CLEARED"}</div>
        <h2>${r.test_name}</h2>
        <div style="font-family:var(--font-display);font-size:3rem;font-weight:700;margin:10px 0;">${r.score}</div>
        <p class="text-muted">out of ${r.total_questions * r.marks_per_question} · ${Number(r.percentage).toFixed(1)}%</p>

        <div class="grid grid-4 mt-24" style="text-align:left;">
          <div><div class="text-muted" style="font-size:0.8rem;">Total Questions</div><strong>${r.total_questions}</strong></div>
          <div><div class="text-muted" style="font-size:0.8rem;">Attempted</div><strong>${r.attempted}</strong></div>
          <div><div class="text-muted" style="font-size:0.8rem;">Correct</div><strong style="color:var(--green);">${r.correct}</strong></div>
          <div><div class="text-muted" style="font-size:0.8rem;">Wrong</div><strong style="color:var(--red);">${r.wrong}</strong></div>
          <div><div class="text-muted" style="font-size:0.8rem;">Unanswered</div><strong>${r.unanswered}</strong></div>
          <div><div class="text-muted" style="font-size:0.8rem;">Positive Marks</div><strong style="color:var(--green);">+${r.positive_marks}</strong></div>
          <div><div class="text-muted" style="font-size:0.8rem;">Negative Marks</div><strong style="color:var(--red);">-${r.negative_marks}</strong></div>
          <div><div class="text-muted" style="font-size:0.8rem;">Auto-submitted</div><strong>${r.auto_submitted ? "Yes" : "No"}</strong></div>
        </div>

        <div class="flex gap-12 mt-24" style="justify-content:center;">
          <a href="history.html" class="btn btn-secondary">Test History</a>
          <a href="tests.html" class="btn btn-primary">More Tests</a>
        </div>
      </div>`;
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="state-block error-block"><h3>Couldn't load result</h3><p>${err.message}</p></div>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  requireAuth((profile) => {
    renderAppShell("history", profile);
    loadResult(profile);
  });
});
