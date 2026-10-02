/* ============================================================
   TALLENTEX — AUTH LOGIC (Supabase version): signup.html + login.html
   ============================================================ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[6-9]\d{9}$/; // adjust to your country's format if needed

function validateField(inputEl, condition, message) {
  const field = inputEl.closest(".field");
  if (!condition) {
    UI.showFieldError(field, message);
    return false;
  }
  UI.clearFieldError(field);
  return true;
}

/* ---------------- Save password + stay signed in ----------------
   Sessions are persisted by Supabase (localStorage + auto token refresh), so
   a returning student/admin is sent straight to their dashboard.
   "Save password" uses the browser's own password manager (Credential
   Management API) — the password is never stored in this site's storage. */
async function offerSavePassword(email, password) {
  if (!(window.PasswordCredential && navigator.credentials && navigator.credentials.store)) return;
  try {
    const ok = await UI.confirmDialog({
      title: "Save password?",
      message: "Save your login on this device so you can sign in faster next time.",
      confirmLabel: "Save",
      cancelLabel: "Not now"
    });
    if (!ok) return;
    const cred = new PasswordCredential({ id: email, password, name: email });
    await navigator.credentials.store(cred);
    UI.toast("Password saved.", "success");
  } catch (e) { /* user's browser declined — continue silently */ }
}

async function prefillSavedLogin(form) {
  if (!(window.PasswordCredential && navigator.credentials && navigator.credentials.get)) return;
  try {
    const cred = await navigator.credentials.get({ password: true, mediation: "silent" });
    if (cred && cred.id && !form.email.value) { form.email.value = cred.id; form.password.value = cred.password || ""; }
  } catch (e) {}
}

async function redirectIfLoggedIn() {
  try {
    const { data: { session } } = await Tallentex.sb.auth.getSession();
    if (!session) return;
    const { data: profile } = await Tallentex.sb.from("profiles").select("role").eq("id", session.user.id).single();
    window.location.replace(profile && profile.role === "admin" ? "admin/dashboard.html" : "dashboard.html");
  } catch (e) {}
}

/* ---------------- SIGNUP ---------------- */
function initSignupForm() {
  const form = document.getElementById("signup-form");
  if (!form) return;

  const pwdInput = form.querySelector("#password");
  const meter = form.querySelector("#strength-meter");
  if (pwdInput && meter) {
    pwdInput.addEventListener("input", () => {
      const v = pwdInput.value;
      let score = 0;
      if (v.length >= 8) score++;
      if (/[A-Z]/.test(v) && /[0-9]/.test(v)) score++;
      if (/[^A-Za-z0-9]/.test(v)) score++;
      meter.className = "strength-meter " + (score <= 1 ? "weak" : score === 2 ? "medium" : "strong");
    });
  }

  form.querySelectorAll(".toggle-visibility").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.closest(".password-field").querySelector("input");
      input.type = input.type === "password" ? "text" : "password";
      btn.textContent = input.type === "password" ? "Show" : "Hide";
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    let valid = true;

    valid = validateField(form.name, data.name.trim().length >= 2, "Please enter the candidate's full name.") && valid;
    valid = validateField(form.fatherName, data.fatherName.trim().length >= 2, "Please enter father's name.") && valid;
    valid = validateField(form.gender, !!data.gender, "Please select a gender.") && valid;
    valid = validateField(form.dob, !!data.dob, "Please select date of birth.") && valid;
    valid = validateField(form.ambition, data.ambition.trim().length >= 2, "Please enter a career ambition.") && valid;
    valid = validateField(form.studentClass, !!data.studentClass, "Please select the class.") && valid;
    valid = validateField(form.schoolName, data.schoolName.trim().length >= 2, "Please enter the school name.") && valid;
    valid = validateField(form.board, !!data.board, "Please select the school board.") && valid;
    valid = validateField(form.email, EMAIL_RE.test(data.email.trim()), "Please enter a valid email address.") && valid;
    valid = validateField(form.mobile, MOBILE_RE.test(data.mobile.trim()), "Please enter a valid 10-digit mobile number.") && valid;
    valid = validateField(form.password, data.password.length >= 8, "Password must be at least 8 characters.") && valid;
    valid = validateField(form.confirmPassword, data.password === data.confirmPassword, "Passwords do not match.") && valid;
    if (!form.proctoringConsent.checked) {
      UI.toast("Please accept the camera monitoring consent to continue.", "error");
      return;
    }

    if (!valid) {
      UI.toast("Please fix the highlighted fields.", "error");
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    UI.setLoading(submitBtn, true, "Creating account…");

    try {
      // All the extra profile fields ride along in options.data — a
      // Postgres trigger (see supabase-schema.sql) reads them and creates
      // the public.profiles row automatically. No plaintext password is
      // ever stored anywhere but Supabase Auth's own hashed store.
      const { data: signUpData, error } = await Tallentex.sb.auth.signUp({
        email: data.email.trim(),
        password: data.password,
        options: {
          data: {
            name: data.name.trim(),
            father_name: data.fatherName.trim(),
            gender: data.gender,
            dob: data.dob,
            ambition: data.ambition.trim(),
            class: data.studentClass,
            school_name: data.schoolName.trim(),
            board: data.board,
            mobile: data.mobile.trim(),
            proctoring_consent: true
          }
        }
      });
      if (error) throw error;

      if (!signUpData.session) {
        // "Confirm email" is turned on in Supabase Auth settings.
        UI.toast("Account created! Please verify your email, then log in.", "success", 7000);
        setTimeout(() => (window.location.href = "login.html"), 1500);
        return;
      }

      UI.toast("Account created! Redirecting…", "success");
      await offerSavePassword(data.email.trim(), data.password);
      setTimeout(() => (window.location.href = "dashboard.html"), 600);
    } catch (err) {
      UI.setLoading(submitBtn, false);
      UI.toast(friendlyAuthError(err), "error", 6000);
    }
  });
}

/* ---------------- LOGIN ---------------- */
function initLoginForm() {
  const form = document.getElementById("login-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    let valid = true;
    valid = validateField(form.email, EMAIL_RE.test(email), "Please enter a valid email address.") && valid;
    valid = validateField(form.password, password.length > 0, "Please enter your password.") && valid;
    if (!valid) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    UI.setLoading(submitBtn, true, "Signing in…");

    try {
      const { data: signInData, error } = await Tallentex.sb.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const { data: profile } = await Tallentex.sb.from("profiles").select("role").eq("id", signInData.user.id).single();
      const role = profile ? profile.role : "student";
      await offerSavePassword(email, password);
      window.location.href = role === "admin" ? "admin/dashboard.html" : "dashboard.html";
    } catch (err) {
      UI.setLoading(submitBtn, false);
      UI.toast(friendlyAuthError(err), "error", 6000);
    }
  });

  const forgotBtn = document.getElementById("forgot-password-btn");
  if (forgotBtn) {
    forgotBtn.addEventListener("click", async () => {
      const email = form.email.value.trim();
      if (!EMAIL_RE.test(email)) {
        UI.toast("Enter your email above first, then tap 'Forgot password'.", "error");
        return;
      }
      try {
        const { error } = await Tallentex.sb.auth.resetPasswordForEmail(email);
        if (error) throw error;
        UI.toast("Password reset email sent. Check your inbox.", "success");
      } catch (err) {
        UI.toast(friendlyAuthError(err), "error");
      }
    });
  }
}

function friendlyAuthError(err) {
  const msg = (err && err.message) || "";
  if (/already registered/i.test(msg)) return "An account with this email already exists. Try logging in instead.";
  if (/invalid login credentials/i.test(msg)) return "Incorrect email or password.";
  if (/password should be/i.test(msg)) return "Password is too weak — use at least 8 characters.";
  if (/rate limit/i.test(msg)) return "Too many attempts. Please wait a moment and try again.";
  if (/network/i.test(msg)) return "Network error — check your connection and try again.";
  return msg || "Something went wrong. Please try again.";
}

/* Guard used at the top of protected pages. */
function requireAuth(onReady, requireAdmin = false) {
  Tallentex.sb.auth.getSession().then(async ({ data: { session } }) => {
    if (!session) {
      window.location.href = requireAdmin ? "../login.html" : "login.html";
      return;
    }
    const user = session.user;
    const { data: profile } = await Tallentex.sb.from("profiles").select("*").eq("id", user.id).single();
    const safeProfile = profile || { role: "student", email: user.email };
    Tallentex.currentUserProfile = { uid: user.id, ...safeProfile };

    if (requireAdmin && safeProfile.role !== "admin") {
      UI.toast("Admin access only.", "error");
      window.location.href = "../dashboard.html";
      return;
    }
    startPresence(user.id, safeProfile.name || user.email);
    UI.initBlockingMessages(user.id);
    onReady(Tallentex.currentUserProfile);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initSignupForm();
  initLoginForm();
  const loginForm = document.getElementById("login-form");
  if (loginForm || document.getElementById("signup-form")) redirectIfLoggedIn();
  if (loginForm) prefillSavedLogin(loginForm);
});
