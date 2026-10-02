/* ============================================================
   TALLENTEX — QUIZ ENGINE (Supabase version, quiz.html)
   ============================================================
   Timer correctness: the countdown is derived every tick from
        (attempt.start_time [DB default now()] + time_limit) - now()
   never from a client-side "secondsLeft" variable a refresh could reset.

   Scoring/submission now happens entirely inside the submit_attempt()
   Postgres function (see supabase-schema.sql), called via RPC — this is
   a stronger guarantee than a client-side transaction, since a student
   can't forge a score no matter what they send from devtools, and the
   function's row lock prevents duplicate submissions outright.
   ============================================================ */

let state = {
  attemptId: null,
  attempt: null,
  questions: [],          // ordered to match attempt.question_ids, options normalized to .options[]
  questionsById: {},
  currentIndex: 0,
  timerInterval: null,
  submitting: false
};

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

async function initQuiz(profile) {
  state.attemptId = getParam("attempt");
  if (!state.attemptId) {
    document.getElementById("quiz-root").innerHTML = errorBlock("No test attempt specified.", "tests.html", "Back to tests");
    return;
  }

  try {
    const { data: attempt, error } = await Tallentex.sb.from("attempts").select("*").eq("id", state.attemptId).single();
    if (error || !attempt) {
      document.getElementById("quiz-root").innerHTML = errorBlock("This test attempt could not be found.", "tests.html", "Back to tests");
      return;
    }
    if (attempt.user_id !== profile.uid) {
      document.getElementById("quiz-root").innerHTML = errorBlock("You don't have permission to view this attempt.", "tests.html", "Back to tests");
      return;
    }
    if (attempt.status === "completed") {
      window.location.href = `result.html?attempt=${state.attemptId}`;
      return;
    }

    // Normalize snake_case DB fields into the camelCase shape the rest of
    // this file uses, so the UI logic below reads identically either way.
    attempt.optionOrders = attempt.option_orders || {};
    attempt.markedForReview = attempt.marked_for_review || [];
    attempt.timeLimit = attempt.time_limit;
    attempt.correctMarks = attempt.correct_marks;
    attempt.negativeMarks = attempt.negative_marks;
    state.attempt = attempt;

    const consented = await requestProctoringConsent();
    if (!consented) {
      window.location.href = "tests.html";
      return;
    }
    await startProctoring(state.attemptId, profile.uid);

    await loadQuestions(attempt.question_ids);
    state.currentIndex = attempt.current_question || 0;

    document.getElementById("test-title").textContent = attempt.test_name;
    renderPalette();
    renderQuestion();
    startTimer();
  } catch (err) {
    console.error(err);
    document.getElementById("quiz-root").innerHTML = errorBlock("Couldn't load the test: " + err.message, "tests.html", "Back to tests");
  }
}

function errorBlock(msg, href, label) {
  return `<div class="state-block error-block"><h3>Something went wrong</h3><p>${msg}</p><a href="${href}" class="btn btn-primary">${label}</a></div>`;
}

async function loadQuestions(ids) {
  const { data: rows, error } = await Tallentex.sb.from("questions").select("*").in("id", ids);
  if (error) throw error;
  (rows || []).forEach((q) => {
    state.questionsById[q.id] = {
      id: q.id, subject: q.subject, topic: q.topic,
      question: q.question_text,
      options: [q.option_a, q.option_b, q.option_c, q.option_d],
      correctAnswer: q.correct_answer
    };
  });
  state.questions = ids.map((id) => state.questionsById[id]).filter(Boolean);
}

/* ---------------- Timer ---------------- */
function startTimer() {
  const pill = document.getElementById("timer-pill");
  const startTime = new Date(state.attempt.start_time);
  const endTime = new Date(startTime.getTime() + state.attempt.timeLimit * 60 * 1000);

  function tick() {
    const msLeft = endTime - new Date();
    if (msLeft <= 0) {
      clearInterval(state.timerInterval);
      pill.textContent = "00:00";
      pill.classList.add("danger");
      autoSubmit();
      return;
    }
    const totalSec = Math.floor(msLeft / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    pill.textContent = `${mm}:${ss}`;
    pill.classList.toggle("warning", totalSec <= 300 && totalSec > 60);
    pill.classList.toggle("danger", totalSec <= 60);
  }
  tick();
  state.timerInterval = setInterval(tick, 1000);
}

/* ---------------- Rendering ---------------- */
function renderQuestion() {
  const q = state.questions[state.currentIndex];
  const root = document.getElementById("question-card");
  if (!q) { root.innerHTML = `<div class="state-block"><h3>Question unavailable</h3></div>`; return; }

  const order = state.attempt.optionOrders[q.id] || [0, 1, 2, 3];
  const selected = state.attempt.answers ? state.attempt.answers[q.id] : undefined;
  const marked = (state.attempt.markedForReview || []).includes(q.id);
  const letters = ["A", "B", "C", "D"];

  root.innerHTML = `
    <div class="q-index">Question ${state.currentIndex + 1} / ${state.questions.length}</div>
    <div class="q-subject">${q.subject}${q.topic ? " · " + q.topic : ""}</div>
    <div class="q-text">${q.question}</div>
    <div class="option-list" role="radiogroup">
      ${order.map((origIdx, pos) => `
        <label class="option-item ${selected === origIdx ? "selected" : ""}" data-orig="${origIdx}">
          <input type="radio" name="option" ${selected === origIdx ? "checked" : ""} />
          <span class="option-letter">${letters[pos]}</span>
          <span class="option-text">${q.options[origIdx]}</span>
        </label>`).join("")}
    </div>
    <label class="mark-review-row flex gap-8" style="align-items:center;">
      <input type="checkbox" id="mark-review-checkbox" ${marked ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--amber);" />
      Mark this question for review
    </label>`;

  root.querySelectorAll(".option-item").forEach((el) => {
    el.addEventListener("click", () => selectOption(q.id, parseInt(el.dataset.orig, 10)));
  });
  document.getElementById("mark-review-checkbox").addEventListener("change", (e) => toggleMarkReview(q.id, e.target.checked));

  document.getElementById("prev-btn").disabled = state.currentIndex === 0;
  document.getElementById("next-btn").textContent = state.currentIndex === state.questions.length - 1 ? "Finish Review" : "Next";
  renderPalette();
}

function renderPalette() {
  const grid = document.getElementById("palette-grid");
  grid.innerHTML = state.questions.map((q, i) => {
    const answered = state.attempt.answers && state.attempt.answers[q.id] !== undefined;
    const marked = (state.attempt.markedForReview || []).includes(q.id);
    const cls = ["palette-btn"];
    if (i === state.currentIndex) cls.push("current");
    if (answered) cls.push("answered"); else cls.push("unanswered");
    if (marked) cls.push("marked");
    return `<button class="${cls.join(" ")}" data-index="${i}">${i + 1}</button>`;
  }).join("");
  grid.querySelectorAll(".palette-btn").forEach((btn) => {
    btn.addEventListener("click", () => goToQuestion(parseInt(btn.dataset.index, 10)));
  });

  const answeredCount = state.questions.filter(q => state.attempt.answers && state.attempt.answers[q.id] !== undefined).length;
  document.getElementById("progress-summary").textContent = `${answeredCount} of ${state.questions.length} answered`;
}

/* ---------------- Interaction: answer saving, navigation ---------------- */
async function selectOption(questionId, originalIndex) {
  state.attempt.answers = state.attempt.answers || {};
  state.attempt.answers[questionId] = originalIndex;
  renderQuestion();

  try {
    const { error } = await Tallentex.sb.from("attempts").update({
      answers: state.attempt.answers,
      last_activity: Tallentex.nowIso()
    }).eq("id", state.attemptId);
    if (error) throw error;
  } catch (err) {
    console.error("Could not save answer:", err);
    UI.toast("Answer saved locally but couldn't sync — check your connection.", "error");
  }
}

async function toggleMarkReview(questionId, isMarked) {
  const list = new Set(state.attempt.markedForReview || []);
  isMarked ? list.add(questionId) : list.delete(questionId);
  state.attempt.markedForReview = Array.from(list);
  renderPalette();
  await Tallentex.sb.from("attempts").update({ marked_for_review: state.attempt.markedForReview }).eq("id", state.attemptId).then(() => {}).catch(() => {});
}

function goToQuestion(index) {
  if (index < 0 || index >= state.questions.length) return;
  state.currentIndex = index;
  renderQuestion();
  Tallentex.sb.from("attempts").update({ current_question: index, last_activity: Tallentex.nowIso() }).eq("id", state.attemptId).then(() => {}).catch(() => {});
  closeMobilePalette();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeMobilePalette() {
  document.getElementById("palette-panel").classList.remove("open");
  document.getElementById("palette-backdrop").classList.remove("open");
}

/* ---------------- Submission + scoring ---------------- */
async function submitTest(isAuto) {
  if (state.submitting) return;
  if (!isAuto) {
    const answeredCount = state.questions.filter(q => state.attempt.answers && state.attempt.answers[q.id] !== undefined).length;
    const unanswered = state.questions.length - answeredCount;
    const ok = await UI.confirmDialog({
      title: "Submit test?",
      message: unanswered > 0
        ? `You have ${unanswered} unanswered question(s). Once submitted, you cannot make changes.`
        : "Once submitted, you cannot make changes.",
      confirmLabel: "Submit"
    });
    if (!ok) return;
  }
  await finalizeSubmission(isAuto);
}

async function autoSubmit() {
  UI.toast("Time's up — submitting your test automatically.", "info", 5000);
  await finalizeSubmission(true);
}

async function finalizeSubmission(isAuto) {
  if (state.submitting) return;
  state.submitting = true;
  clearInterval(state.timerInterval);
  document.querySelectorAll(".option-item, .palette-btn, #next-btn, #prev-btn, #submit-btn").forEach(el => el.style.pointerEvents = "none");

  try {
    // Duplicate-submission guard lives inside submit_attempt() itself (a
    // row lock + status check), so a race between two tabs or the
    // auto-submit timer + a manual click can't double-score an attempt.
    const { error } = await Tallentex.sb.rpc("submit_attempt", { p_attempt_id: state.attemptId, p_auto_submitted: !!isAuto });
    if (error) throw error;

    stopProctoring();
    window.location.href = `result.html?attempt=${state.attemptId}`;
  } catch (err) {
    console.error(err);
    state.submitting = false;
    UI.toast("Submission failed: " + err.message + " — please try again.", "error", 8000);
    document.querySelectorAll(".option-item, .palette-btn, #next-btn, #prev-btn, #submit-btn").forEach(el => el.style.pointerEvents = "");
  }
}

/* ---------------- Wire up static controls ---------------- */
function initQuizControls() {
  document.getElementById("prev-btn").addEventListener("click", () => goToQuestion(state.currentIndex - 1));
  document.getElementById("next-btn").addEventListener("click", () => {
    if (state.currentIndex === state.questions.length - 1) { openMobilePalette(); return; }
    goToQuestion(state.currentIndex + 1);
  });
  document.getElementById("submit-btn").addEventListener("click", () => submitTest(false));

  const toggle = document.getElementById("mobile-palette-toggle");
  if (toggle) toggle.addEventListener("click", openMobilePalette);
  const backdrop = document.getElementById("palette-backdrop");
  if (backdrop) backdrop.addEventListener("click", closeMobilePalette);

  window.addEventListener("beforeunload", (e) => {
    if (!state.submitting && state.attempt) { e.preventDefault(); e.returnValue = ""; }
  });
}

function openMobilePalette() {
  document.getElementById("palette-panel").classList.add("open");
  document.getElementById("palette-backdrop").classList.add("open");
}

document.addEventListener("DOMContentLoaded", () => {
  requireAuth((profile) => {
    initQuizControls();
    initQuiz(profile);
  });
});
