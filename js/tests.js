/* ============================================================
   TALLENTEX — TESTS LIST + ATTEMPT STARTING LOGIC (Supabase version)
   ============================================================ */

async function loadTests(profile) {
  const listEl = document.getElementById("tests-list");
  listEl.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading tests…</div>`;

  try {
    const nowIso = Tallentex.nowIso();
    const { data: rows, error } = await Tallentex.sb
      .from("tests")
      .select("*, test_subjects(subject_name, question_count)")
      .eq("status", "published")
      .or(`start_at.is.null,start_at.lte.${nowIso}`)
      .or(`end_at.is.null,end_at.gte.${nowIso}`);
    if (error) throw error;

    const tests = (rows || []).filter((t) => accessAllowsUser(t, profile))
      .map((t) => ({ ...t, totalQuestions: (t.test_subjects || []).reduce((s, x) => s + x.question_count, 0) }));

    if (tests.length === 0) {
      listEl.innerHTML = `<div class="state-block"><h3>No tests available</h3><p>Your administrator hasn't published any tests you have access to yet.</p></div>`;
      return;
    }

    listEl.innerHTML = "";
    for (const t of tests) {
      const { data: myAttempts } = await Tallentex.sb.from("attempts").select("id, status").eq("user_id", profile.uid).eq("test_id", t.id);
      const attemptCount = (myAttempts || []).length;
      const inProgress = (myAttempts || []).find(a => a.status === "in-progress");

      const card = document.createElement("div");
      card.className = "card test-card";
      const subjectTags = (t.test_subjects || []).map(s => `<span class="subject-tag">${s.subject_name} · ${s.question_count}</span>`).join("");
      const attemptsUsed = `${attemptCount} / ${t.max_attempts || 1} attempts used`;
      const disabled = !inProgress && attemptCount >= (t.max_attempts || 1);

      card.innerHTML = `
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
          <span>🔁 ${attemptsUsed}</span>
        </div>
        <button class="btn btn-primary btn-block start-btn" ${disabled ? "disabled" : ""}>
          ${inProgress ? "Resume Test" : disabled ? "No attempts left" : "Start Test"}
        </button>`;

      card.querySelector(".start-btn").addEventListener("click", () => startOrResumeAttempt(t, profile, inProgress));
      listEl.appendChild(card);
    }
  } catch (err) {
    console.error(err);
    listEl.innerHTML = `<div class="state-block error-block"><h3>Couldn't load tests</h3><p>${err.message}</p></div>`;
  }
}

async function startOrResumeAttempt(test, profile, existingAttempt) {
  if (existingAttempt) {
    window.location.href = `quiz.html?attempt=${existingAttempt.id}`;
    return;
  }

  const ok = await UI.confirmDialog({
    title: `Start "${test.name}"?`,
    message: `You will have ${test.time_limit} minutes once you begin. The timer cannot be paused.`,
    confirmLabel: "Start Now"
  });
  if (!ok) return;

  try {
    const questionIds = await buildQuestionSetForTest(test);

    // optionOrders[qid] = permutation of [0,1,2,3]; displayed position i
    // shows original option optionOrders[qid][i]. Generated once and stored
    // so a refresh always shows the same order.
    const optionOrders = {};
    questionIds.forEach((qid) => {
      optionOrders[qid] = test.randomize_options ? shuffleArray([0, 1, 2, 3]) : [0, 1, 2, 3];
    });

    const { data: attempt, error } = await Tallentex.sb.from("attempts").insert({
      user_id: profile.uid,
      test_id: test.id,
      test_name: test.name,
      question_ids: questionIds,
      option_orders: optionOrders,
      answers: {},
      marked_for_review: [],
      current_question: 0,
      status: "in-progress",
      correct_marks: test.correct_marks,
      negative_marks: test.negative_marks,
      time_limit: test.time_limit,
      passing_marks: test.passing_marks || 0,
      allow_review: !!test.allow_review,
      show_result_immediately: test.show_result_immediately !== false
    }).select().single();
    if (error) throw error;

    window.location.href = `quiz.html?attempt=${attempt.id}`;
  } catch (err) {
    console.error(err);
    UI.toast("Could not start the test: " + err.message, "error");
  }
}

/* Picks questionIds per the test's subject-wise distribution, respecting
   Randomize Questions ON/OFF. Options randomization happens in
   startOrResumeAttempt so two students never share an option order. */
async function buildQuestionSetForTest(test) {
  let allIds = [];
  for (const subj of test.test_subjects || []) {
    const { data: rows, error } = await Tallentex.sb
      .from("questions")
      .select("id")
      .eq("subject", subj.subject_name)
      .eq("class", test.class)
      .eq("status", "approved")
      .limit(subj.question_count * 3); // overfetch a bit so we can randomly sample
    if (error) throw error;
    let ids = (rows || []).map(r => r.id);
    if (test.randomize_questions) ids = shuffleArray(ids);
    allIds = allIds.concat(ids.slice(0, subj.question_count));
  }
  if (test.randomize_questions) allIds = shuffleArray(allIds);
  return allIds;
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

document.addEventListener("DOMContentLoaded", () => {
  requireAuth((profile) => {
    renderAppShell("tests", profile);
    loadTests(profile);
  });
});
