/* ============================================================
   TALLENTEX — TEST HISTORY LOGIC (Supabase version)
   ============================================================ */

async function loadHistory(profile) {
  const root = document.getElementById("history-list");
  root.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading history…</div>`;

  try {
    const { data: rows, error } = await Tallentex.sb.from("results").select("*").eq("user_id", profile.uid).order("submit_time", { ascending: false });
    if (error) throw error;
    if (!rows || rows.length === 0) {
      root.innerHTML = `<div class="state-block"><h3>No completed tests yet</h3><p>Once you finish a test, it will show up here.</p><a href="tests.html" class="btn btn-primary mt-16">Browse Tests</a></div>`;
      return;
    }
    root.innerHTML = "";
    rows.forEach((r) => {
      const date = r.submit_time ? new Date(r.submit_time).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";
      const passed = r.score >= (r.passing_marks || 0);
      const card = document.createElement("div");
      card.className = "card test-card";
      card.innerHTML = `
        <div class="flex-between">
          <h3>${r.test_name}</h3>
          <span class="badge ${passed ? "badge-green" : "badge-red"}">${passed ? "Passed" : "Not Cleared"}</span>
        </div>
        <div class="test-meta">
          <span>🗓️ ${date}</span>
          <span>📄 ${r.total_questions} questions</span>
          <span>🎯 ${Number(r.percentage).toFixed(1)}%</span>
        </div>
        <div class="flex-between">
          <strong>Score: ${r.score} / ${r.total_questions * r.marks_per_question}</strong>
          <a href="result.html?attempt=${r.attempt_id}" class="btn btn-secondary btn-sm">View Result</a>
        </div>`;
      root.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="state-block error-block"><h3>Couldn't load history</h3><p>${err.message}</p></div>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  requireAuth((profile) => {
    renderAppShell("history", profile);
    loadHistory(profile);
  });
});
