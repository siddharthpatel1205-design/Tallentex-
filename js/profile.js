/* ============================================================
   TALLENTEX — PROFILE PAGE LOGIC (Supabase version)
   ============================================================ */

function fillProfileForm(profile) {
  const form = document.getElementById("profile-form");
  form.name.value = profile.name || "";
  form.fatherName.value = profile.father_name || "";
  form.ambition.value = profile.ambition || "";
  form.schoolName.value = profile.school_name || "";
  form.mobile.value = profile.mobile || "";
  document.getElementById("profile-email").textContent = profile.email;
  document.getElementById("profile-class").textContent = profile.class || "—";
  document.getElementById("profile-board").textContent = profile.board || "—";
}

function initProfileForm(profile) {
  const form = document.getElementById("profile-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    UI.setLoading(btn, true, "Saving…");
    try {
      const { error } = await Tallentex.sb.from("profiles").update({
        name: form.name.value.trim(),
        father_name: form.fatherName.value.trim(),
        ambition: form.ambition.value.trim(),
        school_name: form.schoolName.value.trim(),
        mobile: form.mobile.value.trim()
      }).eq("id", profile.uid);
      if (error) throw error;
      UI.toast("Profile updated.", "success");
    } catch (err) {
      UI.toast("Couldn't save changes: " + err.message, "error");
    } finally {
      UI.setLoading(btn, false);
    }
  });

  const pwdForm = document.getElementById("password-form");
  pwdForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const current = pwdForm.currentPassword.value;
    const next = pwdForm.newPassword.value;
    if (next.length < 8) { UI.toast("New password must be at least 8 characters.", "error"); return; }

    const btn = pwdForm.querySelector('button[type="submit"]');
    UI.setLoading(btn, true, "Updating…");
    try {
      // Supabase has no separate "reauthenticate" call — verify the current
      // password by attempting a fresh sign-in with it first.
      const { error: reauthError } = await Tallentex.sb.auth.signInWithPassword({ email: profile.email, password: current });
      if (reauthError) throw { message: "wrong-password" };

      const { error } = await Tallentex.sb.auth.updateUser({ password: next });
      if (error) throw error;
      UI.toast("Password updated.", "success");
      pwdForm.reset();
    } catch (err) {
      UI.toast(err.message === "wrong-password" ? "Current password is incorrect." : "Couldn't update password: " + err.message, "error");
    } finally {
      UI.setLoading(btn, false);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  requireAuth((profile) => {
    renderAppShell("profile", profile);
    fillProfileForm(profile);
    initProfileForm(profile);
  });
});
