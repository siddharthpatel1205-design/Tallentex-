-- ============================================================
-- TALLENTEX — MIGRATION 02: message images + student replies
-- Run once in Supabase → SQL Editor. Safe to re-run.
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
