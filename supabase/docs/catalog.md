# Каталог базы — итоговое состояние

> **Файл генерируется.** Правки руками затрёт следующий прогон.
> Пересобрать: `node scripts/sql-catalog.mjs`. Источник — те же файлы и
> в том же порядке, что у `supabase/setup_all.sql`.

Здесь то, что **останется в базе после полного прогона**, а не то, что
написано в отдельно взятом файле. Объект, созданный в одной миграции и
переопределённый в другой, показан один раз — в последней редакции.

## Таблицы

| Таблица | Заведена в | Realtime |
|---|---|---|
| `ai_usage` | 2026-08-24_ai_usage.sql | — |
| `app_state` | 2026-08-05_initial.sql | да |
| `bans` | 2026-08-23_moderation_and_coach.sql | — |
| `blocks` | 2026-08-25_social_graph.sql | — |
| `challenge_days` | 2026-08-23_challenges.sql | — |
| `challenge_members` | 2026-08-23_challenges.sql | — |
| `challenges` | 2026-08-23_challenges.sql | — |
| `close_friends` | 2026-09-09_social_graph_v2.sql | — |
| `coach_links` | 2026-08-23_moderation_and_coach.sql | — |
| `coaches` | 2026-08-23_moderation_and_coach.sql | — |
| `conversation_members` | 2026-09-09_conversations.sql | да |
| `conversations` | 2026-09-09_conversations.sql | да |
| `day_comments` | 2026-08-23_moderation_and_coach.sql | — |
| `diary_access` | 2026-09-09_social_graph_v2.sql | — |
| `follow_requests` | 2026-09-09_social_graph_v2.sql | да |
| `follows` | 2026-08-25_social_graph.sql | да |
| `friendships` | 2026-08-05_initial.sql | — |
| `message_deletions` | 2026-09-09_conversations.sql | — |
| `message_grants` | 2026-09-07_open_messaging_and_diary_privacy.sql | да |
| `message_views` | 2026-09-09_conversations.sql | — |
| `messages` | 2026-08-05_initial.sql | да |
| `notifications` | 2026-08-25_social_graph.sql | да |
| `post_comments` | 2026-08-11_profile_and_thoughts.sql | — |
| `post_reactions` | 2026-08-11_profile_and_thoughts.sql | — |
| `posts` | 2026-08-11_profile_and_thoughts.sql | — |
| `presence` | 2026-08-06_account_sync.sql | — |
| `profiles` | 2026-08-05_initial.sql | — |
| `promo_codes` | 2026-08-25_promo_codes.sql | — |
| `promo_grants` | 2026-08-25_promo_codes.sql | — |
| `restricted_users` | 2026-09-09_social_graph_v2.sql | — |
| `subscriptions` | 2026-08-05_initial.sql | да |
| `support_messages` | 2026-08-23_moderation_and_coach.sql | — |
| `user_mutes` | 2026-09-09_social_graph_v2.sql | — |

Колонки, добавленные позже создания таблицы:

| Таблица | Колонка | Тип | Добавлена в |
|---|---|---|---|
| `app_state` | `last_seen` | timestamptz | 2026-08-05_initial.sql |
| `app_state` | `revision` | bigint not null default 1 | 2026-08-06_account_sync.sql |
| `messages` | `reply_to` | uuid references public.messages(id) on delete set null | 2026-08-05_initial.sql |
| `messages` | `reply_snapshot` | jsonb | 2026-08-05_initial.sql |
| `messages` | `forwarded_name` | text | 2026-08-05_initial.sql |
| `messages` | `read_at` | timestamptz | 2026-08-05_initial.sql |
| `messages` | `reactions` | jsonb not null default '{}'::jsonb | 2026-08-08_chat_reactions.sql |
| `messages` | `client_id` | uuid | 2026-09-05_social_hardening.sql |
| `messages` | `conversation_id` | uuid references public.conversations(id) on delete cascade | 2026-09-09_conversations.sql |
| `messages` | `unsent_at` | timestamptz | 2026-09-09_conversations.sql |
| `messages` | `edited_at` | timestamptz | 2026-09-09_conversations.sql |
| `messages` | `media` | jsonb | 2026-09-09_conversations.sql |
| `messages` | `forwarded_from` | uuid references auth.users(id) on delete set null | 2026-09-09_conversations.sql |
| `posts` | `visibility` | public.post_visibility not null default 'friends' | 2026-08-25_social_graph.sql |
| `posts` | `visibility_migrated` | boolean not null default false | 2026-08-25_social_graph.sql |
| `profiles` | `username` | text | 2026-08-25_social_graph.sql |
| `profiles` | `display_name` | text | 2026-08-25_social_graph.sql |
| `profiles` | `avatar_url` | text | 2026-08-25_social_graph.sql |
| `profiles` | `created_at` | timestamptz not null default now() | 2026-08-25_social_graph.sql |
| `profiles` | `username_changed_at` | timestamptz | 2026-09-05_social_hardening.sql |
| `profiles` | `diary_visibility` | public.diary_audience not null default 'mutuals' | 2026-09-07_open_messaging_and_diary_privacy.sql |
| `profiles` | `is_private` | boolean not null default false | 2026-09-09_social_graph_v2.sql |
| `profiles` | `msg_from_following` | text not null default 'direct' | 2026-09-09_social_graph_v2.sql |
| `profiles` | `msg_from_followers` | text not null default 'request' | 2026-09-09_social_graph_v2.sql |
| `profiles` | `msg_from_others` | text not null default 'request' | 2026-09-09_social_graph_v2.sql |
| `profiles` | `group_invites` | text not null default 'following' | 2026-09-09_social_graph_v2.sql |
| `profiles` | `show_activity` | boolean not null default true | 2026-09-09_social_graph_v2.sql |
| `profiles` | `read_receipts` | boolean not null default true | 2026-09-09_social_graph_v2.sql |

Перечисления:

- `public.notification_type` — 'FOLLOW', 'FRIEND_REQUEST', 'FRIEND_ACCEPTED', 'POST_REACTION', 'POST_COMMENT', 'MESSAGE'
- `public.post_visibility` — 'public', 'followers', 'friends', 'private'
- `public.diary_audience` — 'public', 'followers', 'mutuals', 'private'

## RLS-политики (итоговые)


### ai_usage

- **SELECT** `"ai_usage select own"`
  ```sql
  for select using (auth.uid() = user_id)
  ```

### app_state

- **DELETE** `"own state delete"`
  ```sql
  for delete using (auth.uid() = user_id)
  ```
- **INSERT** `"own state insert"`
  ```sql
  for insert with check (auth.uid() = user_id)
  ```
- **SELECT** `"state select by diary visibility"`
  ```sql
  for select using ( auth.uid() = app_state.user_id or public.can_view_diary(app_state.user_id) )
  ```
- **UPDATE** `"own state update"`
  ```sql
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id)
  ```

### bans

- **SELECT** `"ban select own"`
  ```sql
  for select using (auth.uid() = user_id)
  ```

### blocks

- **DELETE** `"blocks delete own"`
  ```sql
  for delete using (auth.uid() = blocker_id)
  ```
- **INSERT** `"blocks insert own"`
  ```sql
  for insert with check (auth.uid() = blocker_id and blocker_id <> blocked_id)
  ```
- **SELECT** `"blocks select own"`
  ```sql
  for select using (auth.uid() = blocker_id)
  ```

### challenge_days

- **DELETE** `"cday delete"`
  ```sql
  for delete using (auth.uid() = user_id)
  ```
- **INSERT** `"cday upsert"`
  ```sql
  for insert with check (auth.uid() = user_id and public.in_challenge(challenge, auth.uid()))
  ```
- **SELECT** `"cday select"`
  ```sql
  for select using (public.in_challenge(challenge, auth.uid()))
  ```
- **UPDATE** `"cday update"`
  ```sql
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id)
  ```

### challenge_members

- **DELETE** `"member leave"`
  ```sql
  for delete using ( auth.uid() = user_id or exists (select 1 from public.challenges c where c.id = challenge and c.owner = auth.uid()) )
  ```
- **INSERT** `"member join"`
  ```sql
  for insert with check (auth.uid() = user_id)
  ```
- **SELECT** `"member select"`
  ```sql
  for select using (public.in_challenge(challenge, auth.uid()))
  ```

### challenges

- **DELETE** `"challenge delete"`
  ```sql
  for delete using (auth.uid() = owner)
  ```
- **INSERT** `"challenge insert"`
  ```sql
  for insert with check (auth.uid() = owner)
  ```
- **SELECT** `"challenge select"`
  ```sql
  for select using (auth.uid() = owner or public.in_challenge(id, auth.uid()))
  ```
- **UPDATE** `"challenge update"`
  ```sql
  for update using (auth.uid() = owner) with check (auth.uid() = owner)
  ```

### close_friends

- **DELETE** `"close friends delete own"`
  ```sql
  for delete using (auth.uid() = owner_id)
  ```
- **INSERT** `"close friends insert own"`
  ```sql
  for insert with check ( auth.uid() = owner_id and owner_id <> user_id and not public.is_blocked_between(owner_id, user_id) )
  ```
- **SELECT** `"close friends select own"`
  ```sql
  for select using (auth.uid() = owner_id)
  ```

### coach_links

- **DELETE** `"coach link delete"`
  ```sql
  for delete using (auth.uid() = coach or auth.uid() = client)
  ```
- **INSERT** `"coach link invite"`
  ```sql
  for insert with check ( auth.uid() = client and coach <> client and exists (select 1 from public.coaches c where c.user_id = coach) )
  ```
- **SELECT** `"coach link select"`
  ```sql
  for select using (auth.uid() = coach or auth.uid() = client)
  ```
- **UPDATE** `"coach link accept"`
  ```sql
  for update using (auth.uid() = coach) with check (auth.uid() = coach)
  ```

### coaches

- **SELECT** `"coach select all"`
  ```sql
  for select using (auth.role() = 'authenticated')
  ```

### conversation_members

- **SELECT** `"conversation members select"`
  ```sql
  for select using (public.is_conversation_member(conversation_id, auth.uid()))
  ```
- **UPDATE** `"conversation members update own"`
  ```sql
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id)
  ```

### conversations

- **SELECT** `"conversations select member"`
  ```sql
  for select using (public.is_conversation_member(id, auth.uid()))
  ```

### day_comments

- **DELETE** `"day comment delete"`
  ```sql
  for delete using (auth.uid() = author or auth.uid() = client)
  ```
- **INSERT** `"day comment insert"`
  ```sql
  for insert with check ( auth.uid() = author and ( auth.uid() = client or exists ( select 1 from public.coach_links l where l.status = 'accepted' and l.coach = auth.uid() and l.client = day_comments.client ) ) )
  ```
- **SELECT** `"day comment select"`
  ```sql
  for select using ( auth.uid() = client or exists ( select 1 from public.coach_links l where l.status = 'accepted' and l.coach = auth.uid() and l.client = day_comments.client ) )
  ```

### diary_access

- **DELETE** `"diary access delete own"`
  ```sql
  for delete using (auth.uid() = owner_id)
  ```
- **INSERT** `"diary access insert own"`
  ```sql
  for insert with check ( auth.uid() = owner_id and owner_id <> user_id and not public.is_blocked_between(owner_id, user_id) )
  ```
- **SELECT** `"diary access select"`
  ```sql
  for select using (auth.uid() = owner_id or auth.uid() = user_id)
  ```

### follow_requests

- **DELETE** `"follow requests delete own"`
  ```sql
  for delete using (auth.uid() = requester_id or auth.uid() = target_id)
  ```
- **SELECT** `"follow requests select own"`
  ```sql
  for select using (auth.uid() = requester_id or auth.uid() = target_id)
  ```

### follows

- **DELETE** `"follows delete"`
  ```sql
  for delete using (auth.uid() = follower_id or auth.uid() = following_id)
  ```
- **INSERT** `"follows insert own"`
  ```sql
  for insert with check ( auth.uid() = follower_id and follower_id <> following_id and not public.is_blocked_between(follower_id, following_id) and not public.is_private_account(following_id) )
  ```
- **SELECT** `"follows select own"`
  ```sql
  for select using (auth.uid() = follower_id or auth.uid() = following_id)
  ```

### friendships

- **SELECT** `"friendship select"`
  ```sql
  for select using (auth.uid() = requester or auth.uid() = addressee)
  ```

### message_deletions

- **DELETE** `"message deletions delete own"`
  ```sql
  for delete using (auth.uid() = user_id)
  ```
- **INSERT** `"message deletions insert own"`
  ```sql
  for insert with check (auth.uid() = user_id)
  ```
- **SELECT** `"message deletions own"`
  ```sql
  for select using (auth.uid() = user_id)
  ```

### message_grants

- **SELECT** `"message grants select own"`
  ```sql
  for select using (auth.uid() = owner_id or auth.uid() = peer_id)
  ```

### message_views

- **INSERT** `"message views insert own"`
  ```sql
  for insert with check (auth.uid() = user_id)
  ```
- **SELECT** `"message views select"`
  ```sql
  for select using ( auth.uid() = user_id or exists (select 1 from public.messages m where m.id = message_id and m.sender = auth.uid()) )
  ```

### messages

- **DELETE** `"messages delete"`
  ```sql
  for delete using (auth.uid() = sender)
  ```
- **INSERT** `"messages insert"`
  ```sql
  for insert with check ( auth.uid() = sender and ( (recipient is not null and public.can_message(sender, recipient)) or (conversation_id is not null and public.is_conversation_member(conversation_id, auth.uid())) ) )
  ```
- **SELECT** `"messages select"`
  ```sql
  for select using ( ( auth.uid() = sender or auth.uid() = recipient or (conversation_id is not null and public.is_conversation_member(conversation_id, auth.uid())) ) and (recipient is null or not public.is_blocked_between(sender, auth.uid())) )
  ```
- **UPDATE** `"messages mark read"`
  ```sql
  for update using (auth.uid() = recipient) with check (auth.uid() = recipient)
  ```

### notifications

- **DELETE** `"notifications delete own"`
  ```sql
  for delete using (auth.uid() = recipient_id)
  ```
- **SELECT** `"notifications select own"`
  ```sql
  for select using (auth.uid() = recipient_id)
  ```
- **UPDATE** `"notifications mark read"`
  ```sql
  for update using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id)
  ```

### post_comments

- **DELETE** `"post comments delete"`
  ```sql
  for delete using ( auth.uid() = user_id or exists (select 1 from public.posts p where p.id = post_comments.post_id and p.user_id = auth.uid()) )
  ```
- **INSERT** `"post comments insert own"`
  ```sql
  for insert with check (auth.uid() = user_id and public.can_view_post(post_id))
  ```
- **SELECT** `"post comments select"`
  ```sql
  for select using ( public.can_view_post(post_id) and not public.is_blocked_between(post_comments.user_id, auth.uid()) )
  ```

### post_reactions

- **DELETE** `"post reactions delete own"`
  ```sql
  for delete using (auth.uid() = user_id)
  ```
- **INSERT** `"post reactions insert own"`
  ```sql
  for insert with check (auth.uid() = user_id and public.can_view_post(post_id))
  ```
- **SELECT** `"post reactions select own"`
  ```sql
  for select using (auth.uid() = user_id)
  ```
- **UPDATE** `"post reactions update own"`
  ```sql
  for update using (auth.uid() = user_id and public.can_view_post(post_id)) with check (auth.uid() = user_id and public.can_view_post(post_id))
  ```

### posts

- **DELETE** `"posts delete own"`
  ```sql
  for delete using (auth.uid() = user_id)
  ```
- **INSERT** `"posts insert own"`
  ```sql
  for insert with check (auth.uid() = user_id)
  ```
- **SELECT** `"posts select"`
  ```sql
  for select using ( auth.uid() = posts.user_id or ( not public.is_blocked_between(posts.user_id, auth.uid()) and ( not public.is_private_account(posts.user_id) or public.follows_user(auth.uid(), posts.user_id) ) and ( posts.visibility = 'public' or (posts.visibility = 'followers' and public.follows_user(auth.uid(), posts.user_id)) or (posts.visibility = 'friends' and public.follows_user(auth.uid(), posts.user_id) and public.follows_user(posts.user_id, auth.uid())) or (posts.visibility = 'close_friends' and public.is_close_friend(posts.user_id, auth.uid())) ) ) )
  ```
- **UPDATE** `"posts update own"`
  ```sql
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id)
  ```

### presence

- **SELECT** `"presence select by activity setting"`
  ```sql
  for select using ( auth.uid() = presence.user_id or public.can_see_activity(presence.user_id) )
  ```

### profiles

- **SELECT** `"profiles select own"`
  ```sql
  for select using (auth.uid() = user_id)
  ```

### promo_grants

- **SELECT** `"promo grants select own"`
  ```sql
  for select using (auth.uid() = user_id)
  ```

### restricted_users

- **DELETE** `"restricted delete own"`
  ```sql
  for delete using (auth.uid() = owner_id)
  ```
- **INSERT** `"restricted insert own"`
  ```sql
  for insert with check (auth.uid() = owner_id and owner_id <> restricted_id)
  ```
- **SELECT** `"restricted select own"`
  ```sql
  for select using (auth.uid() = owner_id)
  ```

### storage

- **DELETE** `"chat-images delete own"`
  ```sql
  .objects for delete using ( bucket_id = 'chat-images' and (storage.foldername(name))[1] = auth.uid()::text )
  ```
- **DELETE** `"post-images delete own"`
  ```sql
  .objects for delete using ( bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text )
  ```
- **DELETE** `"dm-media delete own"`
  ```sql
  .objects for delete using ( bucket_id = 'dm-media' and (storage.foldername(name))[2] = auth.uid()::text )
  ```
- **INSERT** `"chat-images write own"`
  ```sql
  .objects for insert with check ( bucket_id = 'chat-images' and auth.role() = 'authenticated' and (storage.foldername(name))[1] = auth.uid()::text )
  ```
- **INSERT** `"post-images write own"`
  ```sql
  .objects for insert with check ( bucket_id = 'post-images' and auth.role() = 'authenticated' and (storage.foldername(name))[1] = auth.uid()::text )
  ```
- **INSERT** `"dm-media write members"`
  ```sql
  .objects for insert with check ( bucket_id = 'dm-media' and auth.role() = 'authenticated' and public.is_conversation_member( public.safe_uuid((storage.foldername(name))[1]), auth.uid() ) and (storage.foldername(name))[2] = auth.uid()::text )
  ```
- **SELECT** `"chat-images read"`
  ```sql
  .objects for select using (bucket_id = 'chat-images')
  ```
- **SELECT** `"post-images read"`
  ```sql
  .objects for select using (bucket_id = 'post-images')
  ```
- **SELECT** `"dm-media read members"`
  ```sql
  .objects for select using ( bucket_id = 'dm-media' and public.is_conversation_member( public.safe_uuid((storage.foldername(name))[1]), auth.uid() ) )
  ```

### subscriptions

- **SELECT** `"sub select own"`
  ```sql
  for select using (auth.uid() = user_id)
  ```

### support_messages

- **SELECT** `"support select own"`
  ```sql
  for select using (auth.uid() = user_id)
  ```

### user_mutes

- **DELETE** `"mutes delete own"`
  ```sql
  for delete using (auth.uid() = owner_id)
  ```
- **INSERT** `"mutes insert own"`
  ```sql
  for insert with check (auth.uid() = owner_id and owner_id <> target_id)
  ```
- **SELECT** `"mutes select own"`
  ```sql
  for select using (auth.uid() = owner_id)
  ```
- **UPDATE** `"mutes update own"`
  ```sql
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id)
  ```

Таблицы без единой политики на команду — команда запрещена клиенту целиком;
пишет в них только `service_role` или `SECURITY DEFINER`-функция.

## Функции

| Функция | Аргументы | Возвращает | Security | Кому EXECUTE | Определена в | Зовут |
|---|---|---|---|---|---|---|
| `accept_conversation_request` | `p_conversation uuid` | text | definer | authenticated | 2026-09-09_conversations.sql | — |
| `accept_follow_request` | `p_requester uuid` | text | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `accept_message_request` | `p_peer uuid` | text | definer | authenticated | 2026-09-09_conversations.sql | — |
| `add_conversation_members` | `p_conversation uuid, p_members uuid[]` | int | definer | authenticated | 2026-09-09_conversations.sql | — |
| `ai_usage_add` | `p_user_id uuid, p_period text, p_micro bigint, p_count boolean default true` | bigint | definer | service_role | 2026-08-24_ai_usage.sql | api/ai/_shared.js |
| `block_user` | `p_user uuid` | text | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `can_invite_to_group` | `p_inviter uuid, p_invitee uuid` | boolean | definer, stable | authenticated | 2026-09-09_conversations.sql | — |
| `can_message` | `p_sender uuid, p_recipient uuid` | boolean | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `can_see_activity` | `p_owner uuid` | boolean | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `can_view_diary` | `p_owner uuid` | boolean | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `can_view_post` | `p_post_id uuid` | boolean | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `can_view_profile_content` | `p_owner uuid` | boolean | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `challenge_board` | `p_challenge uuid` | table (user_id uuid, name text, scored int) | definer, stable | authenticated | 2026-08-23_challenges.sql | src/lib/supabase.js |
| `claim_username` | `p_user_id uuid, p_hint text` | text | definer | — (никому) | 2026-08-26_nickname_identity.sql | — |
| `clear_conversation` | `p_conversation uuid` | void | definer | authenticated | 2026-09-09_conversations.sql | — |
| `conversation_info` | `p_conversation uuid` | table ( id uuid, kind text, title text, avatar_url text, created_by uuid, created_at timestamptz, my_role text, my_state text, archived boolean, muted_until timestamptz, peer_id uuid, peer_username text, peer_name text, peer_avatar text, members_count int, media_count int ) | definer, stable | authenticated | 2026-09-09_conversations.sql | src/lib/messaging.js |
| `conversation_media` | `p_conversation uuid, p_limit int default 60, p_offset int default 0` | table ( id uuid, sender uuid, image_url text, media jsonb, created_at timestamptz ) | definer, stable | authenticated | 2026-09-09_conversations.sql | src/lib/messaging.js |
| `conversation_member_list` | `p_conversation uuid` | table ( user_id uuid, username text, display_name text, avatar_url text, role text, joined_at timestamptz ) | definer, stable | authenticated | 2026-09-09_conversations.sql | src/lib/messaging.js |
| `conversation_role` | `p_conversation uuid, p_user uuid` | text | definer, stable | authenticated | 2026-09-09_conversations.sql | — |
| `conversation_state` | `p_owner uuid, p_peer uuid` | text | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `create_group_conversation` | `p_title text, p_members uuid[]` | uuid | definer | authenticated | 2026-09-09_conversations.sql | — |
| `decline_conversation_request` | `p_conversation uuid` | text | definer | authenticated | 2026-09-09_conversations.sql | — |
| `decline_follow_request` | `p_requester uuid` | text | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `decline_message_request` | `p_peer uuid` | text | definer | authenticated | 2026-09-09_conversations.sql | — |
| `delete_current_user` | `` | void | definer | authenticated | 2026-08-05_initial.sql | src/lib/supabase.js |
| `delete_message_for_me` | `p_message uuid` | void | definer | authenticated | 2026-09-09_conversations.sql | — |
| `direct_conversation` | `p_peer uuid` | uuid | definer | authenticated | 2026-09-09_conversations.sql | — |
| `find_user_by_username` | `p_username text` | uuid | definer, stable | authenticated | 2026-08-26_nickname_identity.sql | src/lib/supabase.js |
| `follow_request_count` | `` | int | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | src/lib/social.js |
| `follow_user` | `p_target uuid` | text | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `follows_user` | `p_follower uuid, p_target uuid` | boolean | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `forward_message` | `p_message uuid, p_conversations uuid[]` | int | definer | authenticated | 2026-09-09_conversations.sql | — |
| `friend_briefs` | `p_user_ids uuid[]` | table (user_id uuid, name text, avatar text) | definer, stable | authenticated | 2026-09-05_social_hardening.sql | — |
| `friend_state` | `p_user_id uuid` | jsonb | definer, stable | authenticated | 2026-09-07_open_messaging_and_diary_privacy.sql | src/lib/supabase.js |
| `get_last_seen` | `p_user_id uuid` | timestamptz | invoker, stable | authenticated | 2026-08-06_account_sync.sql | src/lib/supabase.js |
| `get_message_permission` | `p_sender uuid, p_recipient uuid` | text | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `get_relationship` | `p_user_id uuid` | table ( is_self boolean, target_is_private boolean, following boolean, followed_by boolean, mutual_follow boolean, request_sent boolean, request_received boolean, is_close_friend boolean, blocked boolean, blocked_by boolean, restricted boolean, muted_posts boolean, muted_messages boolean, has_diary_access boolean, can_view_content boolean, can_view_diary boolean, can_see_activity boolean, message_permission text, conversation text ) | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | src/lib/social.js |
| `in_challenge` | `p_challenge uuid, p_user uuid` | boolean | definer, stable | authenticated | 2026-08-23_challenges.sql | — |
| `is_banned` | `p_user uuid` | boolean | definer, stable | authenticated | 2026-08-23_moderation_and_coach.sql | — |
| `is_blocked_between` | `p_a uuid, p_b uuid` | boolean | definer, stable | authenticated | 2026-08-25_social_graph.sql | — |
| `is_close_friend` | `p_owner uuid, p_user uuid` | boolean | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `is_conversation_member` | `p_conversation uuid, p_user uuid` | boolean | definer, stable | authenticated | 2026-09-09_conversations.sql | — |
| `is_friend_with` | `p_a uuid, p_b uuid` | boolean | definer, stable | authenticated | 2026-08-26_nickname_identity.sql | — |
| `is_private_account` | `p_user uuid` | boolean | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `is_restricted` | `p_owner uuid, p_user uuid` | boolean | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `issue_promo` | `p_tier text, p_days integer, p_max_uses integer default 1, p_expires_at timestamptz default null, p_note text default null, p_code text default null` | public.promo_codes | definer | service_role | 2026-08-26_daily_usage_and_premium_admin.sql | — |
| `leave_conversation` | `p_conversation uuid` | void | definer | authenticated | 2026-09-09_conversations.sql | — |
| `list_conversation_messages` | `p_conversation uuid, p_limit int default 40, p_before_at timestamptz default null, p_before_id uuid default null` | table ( id uuid, conversation_id uuid, sender uuid, recipient uuid, text text, image_url text, media jsonb, meal_ref jsonb, reply_to uuid, reply_snapshot jsonb, forwarded_name text, reactions jsonb, unsent_at timestamptz, edited_at timestamptz, created_at timestamptz, read_at timestamptz, client_id uuid, media_viewed boolean ) | definer, stable | authenticated | 2026-09-09_conversations.sql | src/lib/messaging.js |
| `list_conversations` | `p_limit int default 100, p_state text default null` | table ( peer_id uuid, username text, display_name text, avatar_url text, state text, last_id uuid, last_sender uuid, last_text text, last_image text, last_meal boolean, last_at timestamptz, unread_count int ) | definer, stable | authenticated | 2026-09-09_conversations.sql | — |
| `list_conversations_v2` | `p_state text default null, -- null = все, 'accepted' | 'pending' p_archived boolean default false, p_limit int default 40, p_before timestamptz default null` | table ( id uuid, kind text, title text, avatar_url text, peer_id uuid, peer_username text, peer_name text, peer_avatar text, peer_private boolean, members_count int, state text, archived boolean, muted_until timestamptz, last_id uuid, last_sender uuid, last_sender_name text, last_text text, last_image text, last_media jsonb, last_meal boolean, last_unsent boolean, last_at timestamptz, unread_count int ) | definer, stable | authenticated | 2026-09-09_conversations.sql | src/lib/messaging.js |
| `list_feed` | `p_limit int default 20, p_before_at timestamptz default null, p_before_id uuid default null` | table ( id uuid, user_id uuid, username text, display_name text, avatar_url text, text text, image_url text, visibility text, created_at timestamptz, edited_at timestamptz, carrots int, broccoli int, my_reaction text, comments_count int ) | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | src/lib/social.js |
| `list_follow_requests` | `p_limit int default 30, p_offset int default 0` | table ( user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz ) | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `list_followers` | `p_user_id uuid, p_limit int default 50, p_offset int default 0` | table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz) | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `list_following` | `p_user_id uuid, p_limit int default 50, p_offset int default 0` | table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz) | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `list_friends` | `p_user_id uuid, p_limit int default 100, p_offset int default 0` | table (user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz) | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `list_messages` | `p_peer uuid, p_limit int default 40, p_before_at timestamptz default null, p_before_id uuid default null` | setof public.messages | definer, stable | authenticated | 2026-09-05_social_hardening.sql | — |
| `list_notifications` | `p_limit int default 40, p_before timestamptz default null` | table ( id uuid, type text, entity_type text, entity_id uuid, metadata jsonb, created_at timestamptz, read_at timestamptz, actor_id uuid, actor_name text, actor_avatar text, actor_username text ) | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | src/lib/social.js |
| `list_post_comments` | `p_post_id uuid, p_limit int default 30, p_before_at timestamptz default null, p_before_id uuid default null` | table ( id uuid, user_id uuid, text text, created_at timestamptz, author_name text, author_avatar text, author_username text ) | definer, stable | authenticated | 2026-09-05_social_hardening.sql | src/lib/supabase.js |
| `list_posts` | `p_user_id uuid, p_limit int default 20, p_before timestamptz default null` | table ( id uuid, user_id uuid, text text, image_url text, visibility text, created_at timestamptz, edited_at timestamptz, carrots int, broccoli int, my_reaction text, comments_count int ) | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | src/lib/supabase.js |
| `list_relation` | `p_kind text, p_limit int default 100, p_offset int default 0` | table ( user_id uuid, username text, display_name text, avatar_url text, created_at timestamptz, mute_posts boolean, mute_messages boolean ) | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `mark_all_notifications_read` | `` | void | definer | authenticated | 2026-08-25_social_graph.sql | src/lib/social.js |
| `mark_conversation_read` | `p_conversation uuid` | void | definer | authenticated | 2026-09-09_conversations.sql | — |
| `mark_media_viewed` | `p_message uuid` | void | definer | authenticated | 2026-09-09_conversations.sql | — |
| `mark_messages_read` | `p_sender uuid` | void | definer | authenticated | 2026-09-09_conversations.sql | — |
| `mark_notification_read` | `p_id uuid` | void | definer | authenticated | 2026-08-25_social_graph.sql | src/lib/social.js |
| `my_ban` | `` | table (until timestamptz, reason text) | definer, stable | authenticated | 2026-08-23_moderation_and_coach.sql | src/lib/supabase.js |
| `my_diary_visibility` | `` | text | definer, stable | authenticated | 2026-09-07_open_messaging_and_diary_privacy.sql | src/lib/social.js |
| `my_privacy` | `` | table ( is_private boolean, diary_visibility text, msg_from_following text, msg_from_followers text, msg_from_others text, group_invites text, show_activity boolean, read_receipts boolean, close_friends_count int, blocked_count int, restricted_count int, muted_count int, diary_access_count int ) | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | src/lib/social.js |
| `pending_request_count` | `` | int | definer, stable | authenticated | 2026-09-09_conversations.sql | — |
| `push_notification` | `p_recipient uuid, p_actor uuid, p_type text, p_entity_type text default null, p_entity_id uuid default null, p_metadata jsonb default '{}'::jsonb` | void | definer | — (никому) | 2026-09-09_social_graph_v2.sql | — |
| `read_receipts_visible` | `p_peer uuid` | boolean | definer, stable | authenticated | 2026-09-09_conversations.sql | — |
| `reconcile_friendship` | `p_a uuid, p_b uuid` | void | definer | — (никому) | 2026-09-05_social_hardening.sql | — |
| `redeem_promo` | `p_code text` | jsonb | definer | authenticated | 2026-08-25_promo_codes.sql | src/lib/supabase.js |
| `relationships_with` | `p_user_ids uuid[]` | table ( user_id uuid, is_self boolean, target_is_private boolean, following boolean, followed_by boolean, mutual_follow boolean, request_sent boolean, request_received boolean, is_close_friend boolean, blocked boolean, blocked_by boolean, restricted boolean, muted_posts boolean, muted_messages boolean, can_view_content boolean, message_permission text, conversation text ) | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | src/lib/social.js |
| `remove_conversation_member` | `p_conversation uuid, p_user uuid` | void | definer | authenticated | 2026-09-09_conversations.sql | — |
| `remove_follower` | `p_follower uuid` | text | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `rename_conversation` | `p_conversation uuid, p_title text` | text | definer | authenticated | 2026-09-09_conversations.sql | — |
| `safe_uuid` | `p_text text` | uuid | invoker, immutable | PUBLIC (по умолчанию) | 2026-09-09_conversations.sql | — |
| `save_app_state` | `p_state jsonb, p_base_revision bigint default null` | table ( out_revision bigint, out_updated_at timestamptz, out_state jsonb, out_conflict boolean ) | definer | authenticated | 2026-08-08_hardening.sql | src/lib/supabase.js |
| `search_messages` | `p_query text, p_conversation uuid default null, p_limit int default 40` | table ( id uuid, conversation_id uuid, sender uuid, text text, created_at timestamptz, peer_id uuid, title text ) | definer, stable | authenticated | 2026-09-09_conversations.sql | src/lib/messaging.js |
| `search_users` | `p_query text, p_limit int default 20` | table ( user_id uuid, username text, display_name text, avatar_url text, is_private boolean ) | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `send_conversation_message` | `p_conversation uuid, p_text text default null, p_image_url text default null, p_media jsonb default null, p_meal_ref jsonb default null, p_reply_to uuid default null, p_reply_snapshot jsonb default null, p_forwarded_name text default null, p_client_id uuid default null` | public.messages | definer | authenticated | 2026-09-09_conversations.sql | src/lib/messaging.js |
| `send_message` | `p_recipient uuid, p_text text default null, p_image_url text default null, p_meal_ref jsonb default null, p_reply_to uuid default null, p_reply_snapshot jsonb default null, p_forwarded_name text default null, p_client_id uuid default null` | public.messages | definer | authenticated | 2026-09-09_conversations.sql | — |
| `set_account_privacy` | `p_private boolean` | boolean | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `set_activity_visibility` | `p_on boolean` | boolean | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `set_close_friend` | `p_user uuid, p_on boolean` | boolean | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `set_conversation_archived` | `p_conversation uuid, p_on boolean` | boolean | definer | authenticated | 2026-09-09_conversations.sql | — |
| `set_conversation_muted` | `p_conversation uuid, p_until timestamptz` | timestamptz | definer | authenticated | 2026-09-09_conversations.sql | — |
| `set_conversation_role` | `p_conversation uuid, p_user uuid, p_role text` | text | definer | authenticated | 2026-09-09_conversations.sql | — |
| `set_diary_access` | `p_user uuid, p_on boolean` | boolean | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `set_diary_visibility` | `p_value text` | text | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `set_group_invites` | `p_value text` | text | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `set_message_policy` | `p_following text, p_followers text, p_others text` | void | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `set_message_reaction` | `p_message uuid, p_emoji text` | jsonb | definer | authenticated | 2026-09-09_conversations.sql | — |
| `set_read_receipts` | `p_on boolean` | boolean | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `set_restricted` | `p_user uuid, p_on boolean` | boolean | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `set_user_mute` | `p_user uuid, p_posts boolean default true, p_messages boolean default false` | void | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `set_username` | `p_username text` | text | definer | authenticated | 2026-09-05_social_hardening.sql | src/lib/social.js |
| `slugify_username` | `p_raw text` | text | invoker, immutable | PUBLIC (по умолчанию) | 2026-08-25_social_graph.sql | — |
| `support_next_allowed_at` | `` | timestamptz | definer, stable | authenticated | 2026-08-23_moderation_and_coach.sql | — |
| `toggle_message_reaction` | `p_message_id uuid, p_emoji text` | jsonb | definer | authenticated | 2026-09-09_conversations.sql | — |
| `toggle_post_reaction` | `p_post_id uuid, p_reaction text` | table (carrots int, broccoli int, mine text) | definer | authenticated | 2026-08-11_profile_and_thoughts.sql | src/lib/supabase.js |
| `touch_last_seen` | `` | void | definer | authenticated | 2026-08-06_account_sync.sql | src/lib/supabase.js |
| `unblock_user` | `p_user uuid` | text | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `unfollow_user` | `p_target uuid` | text | definer | authenticated | 2026-09-09_social_graph_v2.sql | — |
| `unread_notification_count` | `` | int | definer, stable | authenticated | 2026-08-25_social_graph.sql | src/lib/social.js |
| `unread_totals` | `` | table ( messages int, message_requests int, follow_requests int, notifications int ) | definer, stable | authenticated | 2026-09-09_conversations.sql | src/lib/messaging.js |
| `unsend_message` | `p_message uuid` | void | definer | authenticated | 2026-09-09_conversations.sql | — |
| `user_brief` | `p_user uuid` | table (username text, name text) | definer, stable | authenticated | 2026-08-26_nickname_identity.sql | — |
| `user_cards` | `p_user_ids uuid[]` | table ( user_id uuid, username text, display_name text, avatar_url text, is_private boolean ) | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | src/lib/social.js<br>src/lib/supabase.js |
| `user_profile` | `p_user_id uuid` | table ( user_id uuid, username text, display_name text, avatar_url text, is_private boolean, is_self boolean, can_view_content boolean, followers_count int, following_count int, friends_count int, posts_count int ) | definer, stable | authenticated | 2026-09-09_social_graph_v2.sql | src/lib/social.js |
| `visible_diary` | `p_user_id uuid` | jsonb | definer, stable | authenticated | 2026-09-07_open_messaging_and_diary_privacy.sql | — |

## Триггерные функции

| Функция | Определена в |
|---|---|
| `admin_subscriptions_apply` | 2026-08-26_admin_subscriptions_writable.sql |
| `apply_block` | 2026-09-09_social_graph_v2.sql |
| `cleanup_comment_notification` | 2026-09-05_social_hardening.sql |
| `cleanup_follow_request_notification` | 2026-09-09_social_graph_v2.sql |
| `cleanup_friendship_notifications` | 2026-08-25_social_graph.sql |
| `cleanup_post_notifications` | 2026-09-05_social_hardening.sql |
| `cleanup_post_reaction_notification` | 2026-08-25_social_graph.sql |
| `guard_app_state_update` | 2026-08-06_account_sync.sql |
| `guard_challenge_day` | 2026-08-23_challenges.sql |
| `guard_conversation_member_update` | 2026-09-09_conversations.sql |
| `guard_message_update` | 2026-09-09_conversations.sql |
| `guard_notification_update` | 2026-09-08_notification_upsert_fix.sql |
| `guard_post_update` | 2026-08-11_profile_and_thoughts.sql |
| `guard_profile_update` | 2026-09-05_social_hardening.sql |
| `handle_new_user` | 2026-08-26_nickname_identity.sql |
| `limit_follow_requests` | 2026-09-09_social_graph_v2.sql |
| `limit_follows` | 2026-08-25_social_graph.sql |
| `limit_post_comments` | 2026-08-11_profile_and_thoughts.sql |
| `limit_post_reactions` | 2026-09-05_social_hardening.sql |
| `limit_posts` | 2026-08-11_profile_and_thoughts.sql |
| `limit_unaccepted_messages` | 2026-09-09_conversations.sql |
| `lock_follow_pair` | 2026-09-05_social_hardening.sql |
| `notify_on_follow` | 2026-09-09_social_graph_v2.sql |
| `notify_on_follow_request` | 2026-09-09_social_graph_v2.sql |
| `notify_on_friendship` | 2026-08-26_nickname_identity.sql |
| `notify_on_message` | 2026-09-09_conversations.sql |
| `notify_on_post_comment` | 2026-08-25_social_graph.sql |
| `notify_on_post_reaction` | 2026-08-25_social_graph.sql |
| `sync_friendship_from_follows` | 2026-09-05_social_hardening.sql |
| `sync_profile_from_state` | 2026-09-05_social_hardening.sql |

## Триггеры

BEFORE- и AFTER-триггеры одной таблицы Postgres выполняет **в алфавитном
порядке имён**. Порядок в таблицах ниже — тот же, в котором они сработают.

### admin_subscriptions

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `admin_subscriptions_instead_of_update` | INSTEAD OF update | `admin_subscriptions_apply` | 2026-08-26_admin_subscriptions_writable.sql |

### app_state

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `app_state_update_guard` | BEFORE update | `guard_app_state_update` | 2026-08-06_account_sync.sql |
| 2 | `app_state_profile_sync` | AFTER insert or update of state | `sync_profile_from_state` | 2026-08-25_social_graph.sql |

### auth.users

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `on_auth_user_created` | AFTER insert | `handle_new_user` | 2026-08-05_initial.sql |

### blocks

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `blocks_apply` | AFTER insert | `apply_block` | 2026-08-25_social_graph.sql |

### challenge_days

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `challenge_day_guard` | BEFORE insert or update | `guard_challenge_day` | 2026-08-23_challenges.sql |

### conversation_members

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `conversation_members_update_guard` | BEFORE update | `guard_conversation_member_update` | 2026-09-09_conversations.sql |

### follow_requests

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `follow_requests_rate_limit` | BEFORE insert | `limit_follow_requests` | 2026-09-09_social_graph_v2.sql |
| 2 | `follow_requests_notify` | AFTER insert | `notify_on_follow_request` | 2026-09-09_social_graph_v2.sql |
| 3 | `follow_requests_notify_cleanup` | AFTER delete | `cleanup_follow_request_notification` | 2026-09-09_social_graph_v2.sql |

### follows

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `follows_aa_pair_lock` | BEFORE insert or delete | `lock_follow_pair` | 2026-09-05_social_hardening.sql |
| 2 | `follows_rate_limit` | BEFORE insert | `limit_follows` | 2026-08-26_nickname_identity.sql |
| 3 | `follows_notify` | AFTER insert | `notify_on_follow` | 2026-09-09_social_graph_v2.sql |
| 4 | `follows_sync_friendship_del` | AFTER delete | `sync_friendship_from_follows` | 2026-08-26_nickname_identity.sql |
| 5 | `follows_sync_friendship_ins` | AFTER insert | `sync_friendship_from_follows` | 2026-08-26_nickname_identity.sql |

### friendships

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `friendships_notify` | AFTER insert | `notify_on_friendship` | 2026-09-05_social_hardening.sql |
| 2 | `friendships_notify_cleanup` | AFTER delete | `cleanup_friendship_notifications` | 2026-08-25_social_graph.sql |

### messages

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `messages_request_quota` | BEFORE insert | `limit_unaccepted_messages` | 2026-09-07_open_messaging_and_diary_privacy.sql |
| 2 | `messages_update_guard` | BEFORE update | `guard_message_update` | 2026-08-05_initial.sql |
| 3 | `messages_notify` | AFTER insert | `notify_on_message` | 2026-08-25_social_graph.sql |

### notifications

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `notifications_update_guard` | BEFORE update | `guard_notification_update` | 2026-08-25_social_graph.sql |

### post_comments

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `post_comments_rate_limit` | BEFORE insert | `limit_post_comments` | 2026-08-11_profile_and_thoughts.sql |
| 2 | `post_comments_notify` | AFTER insert | `notify_on_post_comment` | 2026-08-25_social_graph.sql |
| 3 | `post_comments_notify_cleanup` | AFTER delete | `cleanup_comment_notification` | 2026-09-05_social_hardening.sql |

### post_reactions

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `post_reactions_rate_limit` | BEFORE insert or update | `limit_post_reactions` | 2026-09-05_social_hardening.sql |
| 2 | `post_reactions_notify` | AFTER insert or update | `notify_on_post_reaction` | 2026-08-25_social_graph.sql |
| 3 | `post_reactions_notify_cleanup` | AFTER delete | `cleanup_post_reaction_notification` | 2026-08-25_social_graph.sql |

### posts

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `posts_rate_limit` | BEFORE insert | `limit_posts` | 2026-08-11_profile_and_thoughts.sql |
| 2 | `posts_update_guard` | BEFORE update | `guard_post_update` | 2026-08-11_profile_and_thoughts.sql |
| 3 | `posts_notify_cleanup` | AFTER delete | `cleanup_post_notifications` | 2026-09-05_social_hardening.sql |

### profiles

| Порядок | Триггер | Когда | Функция | Из |
|---|---|---|---|---|
| 1 | `profiles_update_guard` | BEFORE update | `guard_profile_update` | 2026-09-05_social_hardening.sql |

## Индексы

| Индекс | Таблица | Определение | Из |
|---|---|---|---|
| `ai_usage_period_idx` | `ai_usage` | `(period)` | 2026-08-24_ai_usage.sql |
| `bans_until_idx` | `bans` | `(until)` | 2026-08-23_moderation_and_coach.sql |
| `blocks_blocked_idx` | `blocks` | `(blocked_id)` | 2026-08-25_social_graph.sql |
| `challenge_members_user_idx` | `challenge_members` | `(user_id)` | 2026-08-23_challenges.sql |
| `challenges_owner_idx` | `challenges` | `(owner)` | 2026-08-23_challenges.sql |
| `close_friends_user_idx` | `close_friends` | `(user_id)` | 2026-09-09_social_graph_v2.sql |
| `coach_links_client_idx` | `coach_links` | `(client, status)` | 2026-08-23_moderation_and_coach.sql |
| `coach_links_coach_idx` | `coach_links` | `(coach, status)` | 2026-08-23_moderation_and_coach.sql |
| `conversation_members_user_idx` | `conversation_members` | `(user_id, state) where left_at is null` | 2026-09-09_conversations.sql |
| `conversations_direct_pair_uniq` (uniq) | `conversations` | `(pair_low, pair_high) where kind = 'direct'` | 2026-09-09_conversations.sql |
| `conversations_recent_idx` | `conversations` | `(last_message_at desc)` | 2026-09-09_conversations.sql |
| `day_comments_client_day_idx` | `day_comments` | `(client, day, created_at)` | 2026-08-23_moderation_and_coach.sql |
| `diary_access_user_idx` | `diary_access` | `(user_id)` | 2026-09-09_social_graph_v2.sql |
| `follow_requests_requester_idx` | `follow_requests` | `(requester_id, created_at desc)` | 2026-09-09_social_graph_v2.sql |
| `follow_requests_target_idx` | `follow_requests` | `(target_id, created_at desc)` | 2026-09-09_social_graph_v2.sql |
| `follows_follower_idx` | `follows` | `(follower_id, created_at desc)` | 2026-08-25_social_graph.sql |
| `follows_following_idx` | `follows` | `(following_id, created_at desc)` | 2026-08-25_social_graph.sql |
| `friendships_addressee_idx` | `friendships` | `(addressee, status)` | 2026-08-06_account_sync.sql |
| `friendships_pair_uniq` (uniq) | `friendships` | `(least(requester, addressee), greatest(requester, addressee))` | 2026-09-05_social_hardening.sql |
| `friendships_requester_created_idx` | `friendships` | `(requester, created_at desc)` | 2026-08-08_hardening.sql |
| `friendships_requester_idx` | `friendships` | `(requester, status)` | 2026-08-06_account_sync.sql |
| `message_deletions_user_idx` | `message_deletions` | `(user_id)` | 2026-09-09_conversations.sql |
| `message_grants_peer_idx` | `message_grants` | `(peer_id, state)` | 2026-09-07_open_messaging_and_diary_privacy.sql |
| `messages_conversation_idx` | `messages` | `(conversation_id, created_at desc, id desc)` | 2026-09-09_conversations.sql |
| `messages_pair_idx` | `messages` | `(least(sender, recipient), greatest(sender, recipient), created_at desc)` | 2026-08-05_initial.sql |
| `messages_recipient_idx` | `messages` | `(recipient, created_at desc)` | 2026-08-05_initial.sql |
| `messages_sender_client_idx` (uniq) | `messages` | `(sender, client_id) where client_id is not null` | 2026-09-05_social_hardening.sql |
| `messages_sender_recipient_idx` | `messages` | `(sender, recipient, created_at desc)` | 2026-09-07_open_messaging_and_diary_privacy.sql |
| `messages_sender_time_idx` | `messages` | `(sender, created_at desc)` | 2026-09-05_social_hardening.sql |
| `messages_unread_idx` | `messages` | `(recipient, read_at) where read_at is null` | 2026-08-05_initial.sql |
| `notifications_dedup_idx` (uniq) | `notifications` | `(recipient_id, actor_id, type, entity_id) where entity_id is not null` | 2026-08-25_social_graph.sql |
| `notifications_recipient_idx` | `notifications` | `(recipient_id, created_at desc)` | 2026-08-25_social_graph.sql |
| `notifications_unread_idx` | `notifications` | `(recipient_id) where read_at is null` | 2026-08-25_social_graph.sql |
| `post_comments_post_idx` | `post_comments` | `(post_id, created_at)` | 2026-08-11_profile_and_thoughts.sql |
| `post_comments_user_time_idx` | `post_comments` | `(user_id, created_at desc)` | 2026-09-05_social_hardening.sql |
| `post_reactions_post_idx` | `post_reactions` | `(post_id)` | 2026-08-11_profile_and_thoughts.sql |
| `post_reactions_user_time_idx` | `post_reactions` | `(user_id, created_at desc)` | 2026-09-05_social_hardening.sql |
| `posts_author_created_idx` | `posts` | `(user_id, created_at desc)` | 2026-08-25_social_graph.sql |
| `posts_user_created_idx` | `posts` | `(user_id, created_at desc)` | 2026-08-11_profile_and_thoughts.sql |
| `profiles_display_name_lower_idx` | `profiles` | `(lower(display_name) text_pattern_ops)` | 2026-09-09_social_graph_v2.sql |
| `profiles_username_key` (uniq) | `profiles` | `(username)` | 2026-08-25_social_graph.sql |
| `profiles_username_prefix_idx` | `profiles` | `(username text_pattern_ops)` | 2026-08-25_social_graph.sql |
| `restricted_users_target_idx` | `restricted_users` | `(restricted_id)` | 2026-09-09_social_graph_v2.sql |
| `subs_customer_idx` | `subscriptions` | `(stripe_customer_id)` | 2026-08-05_initial.sql |
| `support_user_time_idx` | `support_messages` | `(user_id, created_at desc)` | 2026-08-23_moderation_and_coach.sql |

