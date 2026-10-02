-- ============================================================
-- TALLENTEX — SUPABASE (POSTGRES) SCHEMA
-- ============================================================
-- HOW TO APPLY:
-- Supabase Dashboard → SQL Editor → New Query → paste this whole
-- file → Run. It creates every table, security policy, trigger,
-- and function the app needs, in the correct order.
-- ============================================================

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ============================================================
-- 1. PROFILES  (extends Supabase's built-in auth.users)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  father_name text,
  gender text,
  dob date,
  ambition text,
  class text,
  school_name text,
  board text,
  email text unique not null,
  mobile text,
  role text not null default 'student',
  proctoring_consent boolean default false,
  proctoring_consent_at timestamptz,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row the moment someone signs up, using the extra
-- fields passed in supabase.auth.signUp()'s options.data. This means the
-- client never needs an explicit INSERT permission on profiles at all.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, father_name, gender, dob, ambition, class, school_name, board, email, mobile, role, proctoring_consent, proctoring_consent_at)
  values (
    new.id,
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'father_name',
    new.raw_user_meta_data->>'gender',
    nullif(new.raw_user_meta_data->>'dob','')::date,
    new.raw_user_meta_data->>'ambition',
    new.raw_user_meta_data->>'class',
    new.raw_user_meta_data->>'school_name',
    new.raw_user_meta_data->>'board',
    new.email,
    new.raw_user_meta_data->>'mobile',
    'student',
    coalesce((new.raw_user_meta_data->>'proctoring_consent')::boolean, false),
    now()
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Trusted admin check, used by every policy below. SECURITY DEFINER lets
-- it read profiles.role without recursing into the RLS policy on profiles.
create or replace function public.is_admin()
returns boolean as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$ language sql security definer stable;

alter table public.profiles enable row level security;

create policy "profiles_select_own_or_admin" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

create policy "profiles_update_own_non_role_or_admin" on public.profiles
  for update using (auth.uid() = id or public.is_admin())
  with check (
    public.is_admin() or (auth.uid() = id and role = (select role from public.profiles where id = auth.uid()))
  );
-- No insert/delete policy for regular users — profiles are only created by
-- the trigger above and only deleted by an admin via the service role.

-- ============================================================
-- 2. TESTS
-- ============================================================
create table public.tests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  class text,
  time_limit int not null,
  correct_marks numeric not null,
  negative_marks numeric not null,
  passing_marks numeric default 0,
  max_attempts int default 1,
  randomize_questions boolean default false,
  randomize_options boolean default false,
  show_result_immediately boolean default true,
  allow_review boolean default false,
  status text not null default 'draft', -- 'draft' | 'published'
  start_at timestamptz,
  end_at timestamptz,
  access_type text not null default 'all', -- 'all' | 'selected' | 'class' | 'group'
  access_values text[] default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.test_subjects (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  subject_name text not null,
  question_count int not null
);

alter table public.tests enable row level security;
alter table public.test_subjects enable row level security;

create policy "tests_select_published_or_admin" on public.tests
  for select using (status = 'published' or public.is_admin());
create policy "tests_write_admin_only" on public.tests
  for all using (public.is_admin()) with check (public.is_admin());

create policy "test_subjects_select_all_signedin" on public.test_subjects
  for select using (auth.role() = 'authenticated');
create policy "test_subjects_write_admin_only" on public.test_subjects
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 3. QUESTIONS
-- ============================================================
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  topic text,
  class text,
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_answer int not null,          -- 0-3
  marks numeric not null,
  negative_marks numeric not null,
  difficulty text,
  explanation text,
  tags text[] default '{}',
  status text not null default 'approved', -- 'approved' | 'pending'
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.questions enable row level security;

-- NOTE (same caveat as the Firestore version): any signed-in user can read
-- a question row including correct_answer, because the quiz UI needs to
-- render options client-side. For a high-stakes deployment, move scoring
-- into submit_attempt() (already server-side below) and additionally
-- create a view that excludes correct_answer/explanation for client reads.
create policy "questions_select_signedin" on public.questions
  for select using (auth.role() = 'authenticated');
create policy "questions_write_admin_only" on public.questions
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 4. ATTEMPTS
-- ============================================================
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  test_id uuid not null references public.tests(id),
  test_name text,
  question_ids uuid[] not null,
  option_orders jsonb not null default '{}',   -- { questionId: [0,2,1,3] }
  answers jsonb not null default '{}',          -- { questionId: originalOptionIndex }
  marked_for_review uuid[] default '{}',
  current_question int default 0,
  status text not null default 'in-progress',   -- 'in-progress' | 'completed'
  start_time timestamptz not null default now(),
  last_activity timestamptz default now(),
  submit_time timestamptz,
  auto_submitted boolean default false,
  violations jsonb not null default '[]',
  violation_count int not null default 0,
  correct_marks numeric not null,
  negative_marks numeric not null,
  time_limit int not null,
  passing_marks numeric default 0,
  show_result_immediately boolean default true,
  allow_review boolean default false
);

alter table public.attempts enable row level security;

create policy "attempts_select_own_or_admin" on public.attempts
  for select using (auth.uid() = user_id or public.is_admin());
create policy "attempts_insert_own" on public.attempts
  for insert with check (auth.uid() = user_id);
create policy "attempts_update_own_inprogress_or_admin" on public.attempts
  for update using ((auth.uid() = user_id and status = 'in-progress') or public.is_admin());

-- Needed for the admin Live Monitor to receive realtime updates.
alter publication supabase_realtime add table public.attempts;

-- ============================================================
-- 5. RESULTS
-- ============================================================
create table public.results (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.attempts(id),
  user_id uuid not null references public.profiles(id),
  test_id uuid not null references public.tests(id),
  test_name text,
  total_questions int not null,
  attempted int not null,
  correct int not null,
  wrong int not null,
  unanswered int not null,
  positive_marks numeric not null,
  negative_marks numeric not null,
  marks_per_question numeric not null,
  score numeric not null,
  percentage numeric not null,
  passing_marks numeric default 0,
  submit_time timestamptz not null default now(),
  auto_submitted boolean default false
);

alter table public.results enable row level security;

create policy "results_select_own_or_admin" on public.results
  for select using (auth.uid() = user_id or public.is_admin());
-- Students never INSERT/UPDATE results directly — only submit_attempt()
-- (a SECURITY DEFINER function below) writes this table.
create policy "results_admin_write" on public.results
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 6. MESSAGES  (admin messaging + blocking-popup acknowledgement)
-- ============================================================
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  from_user uuid references public.profiles(id),
  from_name text,
  text text not null,
  is_global boolean not null default false,
  target_user uuid references public.profiles(id),
  sent_at timestamptz not null default now()
);

create table public.message_recipients (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  status text not null default 'pending', -- 'pending' | 'delivered' | 'acknowledged'
  received_at timestamptz,
  acknowledged_at timestamptz
);

alter table public.messages enable row level security;
alter table public.message_recipients enable row level security;

create policy "messages_admin_only" on public.messages
  for all using (public.is_admin()) with check (public.is_admin());

create policy "recipients_select_own_or_admin" on public.message_recipients
  for select using (auth.uid() = user_id or public.is_admin());
create policy "recipients_insert_admin_only" on public.message_recipients
  for insert with check (public.is_admin());
create policy "recipients_update_own_status_or_admin" on public.message_recipients
  for update using (auth.uid() = user_id or public.is_admin());

alter publication supabase_realtime add table public.message_recipients;

-- ============================================================
-- 7. PROCTORING VIOLATIONS LOG (kept denormalized on attempts.violations
--    as jsonb for simplicity; log_violation() below appends to it)
-- ============================================================

-- ============================================================
-- 8. SERVER-SIDE FUNCTIONS (RPC) — the real security boundary for
--    scoring and violation logging, called from the client via
--    supabase.rpc(...). Running as SECURITY DEFINER + explicit
--    ownership checks means a student cannot forge a score no matter
--    what they send from devtools.
-- ============================================================

create or replace function public.log_violation(p_attempt_id uuid, p_type text)
returns void as $$
begin
  update public.attempts
  set violations = violations || jsonb_build_object('type', p_type, 'at', now()),
      violation_count = violation_count + 1
  where id = p_attempt_id and user_id = auth.uid() and status = 'in-progress';
end;
$$ language plpgsql security definer;

create or replace function public.submit_attempt(p_attempt_id uuid, p_auto_submitted boolean)
returns public.results as $$
declare
  v_attempt public.attempts;
  v_correct int := 0;
  v_wrong int := 0;
  v_unanswered int := 0;
  v_qid uuid;
  v_answer int;
  v_correct_answer int;
  v_positive numeric;
  v_negative numeric;
  v_score numeric;
  v_percentage numeric;
  v_result public.results;
begin
  -- Row lock prevents a race between manual submit and auto-submit.
  select * into v_attempt from public.attempts where id = p_attempt_id for update;

  if v_attempt.id is null then
    raise exception 'Attempt not found';
  end if;
  if v_attempt.user_id != auth.uid() then
    raise exception 'Not your attempt';
  end if;
  if v_attempt.status = 'completed' then
    -- Already scored (e.g. a race between two tabs) — return the existing result.
    select * into v_result from public.results where attempt_id = p_attempt_id;
    return v_result;
  end if;

  foreach v_qid in array v_attempt.question_ids loop
    select correct_answer into v_correct_answer from public.questions where id = v_qid;
    if v_attempt.answers ? v_qid::text then
      v_answer := (v_attempt.answers ->> v_qid::text)::int;
      if v_answer = v_correct_answer then v_correct := v_correct + 1;
      else v_wrong := v_wrong + 1;
      end if;
    else
      v_unanswered := v_unanswered + 1;
    end if;
  end loop;

  v_positive := v_correct * v_attempt.correct_marks;
  v_negative := v_wrong * v_attempt.negative_marks;
  v_score := v_positive - v_negative;
  v_percentage := case when array_length(v_attempt.question_ids, 1) > 0
    then (v_score / (array_length(v_attempt.question_ids, 1) * v_attempt.correct_marks)) * 100
    else 0 end;

  update public.attempts
  set status = 'completed', submit_time = now(), auto_submitted = p_auto_submitted
  where id = p_attempt_id;

  insert into public.results (
    attempt_id, user_id, test_id, test_name, total_questions, attempted,
    correct, wrong, unanswered, positive_marks, negative_marks,
    marks_per_question, score, percentage, passing_marks, auto_submitted
  ) values (
    p_attempt_id, v_attempt.user_id, v_attempt.test_id, v_attempt.test_name,
    array_length(v_attempt.question_ids, 1), v_correct + v_wrong, v_correct, v_wrong, v_unanswered,
    v_positive, v_negative, v_attempt.correct_marks, v_score, v_percentage,
    v_attempt.passing_marks, p_auto_submitted
  )
  returning * into v_result;

  return v_result;
end;
$$ language plpgsql security definer;

-- ============================================================
-- 9. STORAGE BUCKET for proctoring snapshots
-- ============================================================
insert into storage.buckets (id, name, public) values ('proctoring', 'proctoring', false)
  on conflict (id) do nothing;

create policy "proctoring_insert_own_inprogress"
  on storage.objects for insert
  with check (
    bucket_id = 'proctoring'
    and exists (
      select 1 from public.attempts
      where id::text = (storage.foldername(name))[1]
        and user_id = auth.uid()
        and status = 'in-progress'
    )
  );

create policy "proctoring_select_admin_only"
  on storage.objects for select
  using (bucket_id = 'proctoring' and public.is_admin());

-- ============================================================
-- 10. APP SETTINGS (single row, used by Admin → Settings)
-- ============================================================
create table public.app_settings (
  id int primary key default 1,
  app_name text default 'Tallentex',
  support_email text,
  default_max_attempts int default 1,
  updated_at timestamptz default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

alter table public.app_settings enable row level security;
create policy "settings_select_signedin" on public.app_settings
  for select using (auth.role() = 'authenticated');
create policy "settings_write_admin" on public.app_settings
  for update using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 11. MESSAGE IMAGES + STUDENT REPLIES (same as migration-02)
-- ============================================================
-- 1. Admin messages can carry an image
alter table public.messages add column if not exists image_path text;

-- 2. Student replies to an admin message (text and/or image)
create table if not exists public.message_replies (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  text text not null default '',
  image_path text,
  created_at timestamptz not null default now()
);
create index if not exists message_replies_message_idx on public.message_replies(message_id);

alter table public.message_replies enable row level security;

drop policy if exists "replies_select_own_or_admin" on public.message_replies;
create policy "replies_select_own_or_admin" on public.message_replies
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "replies_insert_own_recipient" on public.message_replies;
create policy "replies_insert_own_recipient" on public.message_replies
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.message_recipients r
      where r.message_id = message_replies.message_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "replies_admin_all" on public.message_replies;
create policy "replies_admin_all" on public.message_replies
  for all using (public.is_admin()) with check (public.is_admin());

-- Admin gets live notification of new replies
do $$ begin
  alter publication supabase_realtime add table public.message_replies;
exception when duplicate_object then null; end $$;

-- 3. Students must be able to read the message row of messages sent to them
--    (previously admin-only, which is why the popup could not show images/sender).
drop policy if exists "messages_select_recipient" on public.messages;
create policy "messages_select_recipient" on public.messages
  for select using (
    exists (select 1 from public.message_recipients r
            where r.message_id = messages.id and r.user_id = auth.uid())
  );

-- 4. Private storage bucket for message / reply images
--    admin/<file>      -> uploaded by admin, viewable by any signed-in student
--    <student-uid>/<f> -> uploaded by that student, viewable by them + admin
insert into storage.buckets (id, name, public) values ('message-images', 'message-images', false)
on conflict (id) do nothing;

drop policy if exists "msgimg_insert" on storage.objects;
create policy "msgimg_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'message-images' and (
      ((storage.foldername(name))[1] = 'admin' and public.is_admin())
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

drop policy if exists "msgimg_select" on storage.objects;
create policy "msgimg_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'message-images' and (
      public.is_admin()
      or (storage.foldername(name))[1] = 'admin'
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- ============================================================
-- Done. Next: Authentication → Providers → Email, and turn OFF
-- "Confirm email" while developing (Settings → Authentication) so
-- signUp() logs the student straight in — see SETUP-GUIDE.
-- ============================================================
