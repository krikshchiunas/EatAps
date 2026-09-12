-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — вложения перестают быть публичными.
--
-- ЧТО БЫЛО НЕ ТАК
--
-- Бакеты chat-images и post-images создавались с public = true, а политика
-- чтения выглядела так:
--
--     create policy "chat-images read" on storage.objects
--       for select using (bucket_id = 'chat-images');
--
-- То есть предиката не было вовсе: файл отдавался кому угодно, включая
-- неаутентифицированного, по прямой ссылке. Защитой служила только
-- неугадываемость адреса (uuid v4 в пути). Это «ссылка-пропуск»: она не
-- отзывается никогда. Один раз показанное подписчику фото оставалось
-- доступным ему и после отписки, и после блокировки, и после удаления
-- записи, и после удаления всего аккаунта.
--
-- Политика записи при этом проверяла ЗАГРУЖАЮЩЕГО (первый сегмент пути равен
-- auth.uid()), но чтение не проверяло ЧИТАЮЩЕГО вообще. Это две разные
-- проверки, и наличие первой не заменяет вторую.
--
-- ИНВАРИАНТ, КОТОРЫЙ ВВОДИТ ЭТА МИГРАЦИЯ
--
--   Вложение личной переписки может прочитать только участник того
--   сообщения, к которому вложение прикреплено.
--
--   Изображение записи может прочитать только тот, кому видна сама запись.
--
-- Обе проверки выполняет база, а не интерфейс, и обе опираются на ту же
-- функцию видимости, что и остальное приложение (can_view_post), либо на
-- прямое участие в сообщении.
--
-- КАК СВЯЗАТЬ ФАЙЛ С СООБЩЕНИЕМ
--
-- В сообщении хранится готовый публичный URL, а политике хранилища нужен путь
-- внутри бакета (storage.objects.name). Вытаскивать путь подстрокой прямо в
-- политике нельзя: это означало бы LIKE с ведущим шаблоном и полный проход по
-- messages на КАЖДОЕ чтение файла.
--
-- Поэтому заводится ВЫЧИСЛЯЕМАЯ колонка image_path. Она:
--   • заполняется сама и для старых строк, и для будущих — бэкфилл не нужен;
--   • не может разъехаться с image_url, потому что вычисляется из него;
--   • индексируется, и политика превращается в точечный поиск по индексу.
--
-- Клиент по-прежнему хранит в сообщении полный URL — менять состав колонок,
-- которые отдают list_messages и send_message, эта миграция не требует.
--
-- ДАННЫЕ НЕ УДАЛЯЮТСЯ. Ни один объект хранилища эта миграция не трогает,
-- меняются только флаг публичности бакета и политики чтения.
--
-- ПОРЯДОК ВЫКАТКИ. Клиент, который запрашивает подписанную ссылку, работает и
-- с публичным бакетом (подписанная ссылка на публичный объект тоже валидна).
-- Поэтому безопасный порядок: сначала выкатить фронтенд, затем эту миграцию.
-- Обратный порядок оставит старые фото недоступными до выкатки фронтенда.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 1. Путь файла, выведенный из сохранённого URL
-- ---------------------------------------------------------------------------
-- substring(text from pattern) неизменяема, поэтому колонку можно объявить
-- stored — она посчитается один раз при записи строки, а не на каждое чтение.
alter table public.messages
  add column if not exists image_path text
  generated always as (substring(image_url from '/chat-images/(.*)$')) stored;

create index if not exists messages_image_path_idx
  on public.messages (image_path) where image_path is not null;

alter table public.posts
  add column if not exists image_path text
  generated always as (substring(image_url from '/post-images/(.*)$')) stored;

create index if not exists posts_image_path_idx
  on public.posts (image_path) where image_path is not null;

-- ---------------------------------------------------------------------------
-- 2. Кто вправе прочитать вложение переписки
-- ---------------------------------------------------------------------------
-- security definer здесь нужен по существу, а не для удобства: политика
-- хранилища обязана дать однозначный ответ независимо от того, как в будущем
-- изменится RLS на messages. Проверка участия и блокировки выписана явно.
create or replace function public.can_read_chat_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.messages m
    where m.image_path = p_name
      and auth.uid() is not null
      and (
        m.sender = auth.uid()
        or m.recipient = auth.uid()
        or (m.conversation_id is not null
            and public.is_conversation_member(m.conversation_id, auth.uid()))
      )
      -- Блокировка перекрывает участие — ровно как в политике чтения самих
      -- сообщений: заблокировавший не должен видеть и вложения.
      and not public.is_blocked_between(m.sender, auth.uid())
  );
$$;

revoke all on function public.can_read_chat_image(text) from public, anon;
grant execute on function public.can_read_chat_image(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Кто вправе прочитать изображение записи
-- ---------------------------------------------------------------------------
-- Здесь переиспользуется can_view_post — та же функция, которой пользуются
-- политики самих записей, ответов и реакций. Расходиться им нельзя: иначе
-- «запись не видна, а картинка видна» вернётся другим путём.
create or replace function public.can_read_post_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.posts p
    where p.image_path = p_name
      and auth.uid() is not null
      and public.can_view_post(p.id)
  );
$$;

revoke all on function public.can_read_post_image(text) from public, anon;
grant execute on function public.can_read_post_image(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Бакеты становятся закрытыми
-- ---------------------------------------------------------------------------
-- Ограничения на размер и типы уже стояли — сохраняем их и здесь, чтобы
-- повторный прогон на чистой базе давал тот же результат.
update storage.buckets
set public = false,
    file_size_limit = 3 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id in ('chat-images', 'post-images');

-- ---------------------------------------------------------------------------
-- 5. Политики чтения
-- ---------------------------------------------------------------------------
drop policy if exists "chat-images read" on storage.objects;
drop policy if exists "chat-images read participants" on storage.objects;
create policy "chat-images read participants" on storage.objects
  for select using (
    bucket_id = 'chat-images'
    and public.can_read_chat_image(name)
  );

drop policy if exists "post-images read" on storage.objects;
drop policy if exists "post-images read visible" on storage.objects;
create policy "post-images read visible" on storage.objects
  for select using (
    bucket_id = 'post-images'
    and public.can_read_post_image(name)
  );

-- ---------------------------------------------------------------------------
-- 6. Политики записи: подтверждаем прежние правила явно
-- ---------------------------------------------------------------------------
-- Менять их не нужно, но пересоздаём вместе с чтением, чтобы весь набор правил
-- по этим бакетам читался в одном месте, а не был разбросан по трём миграциям.
-- Путь обязан начинаться с папки автора: имя файла приходит от клиента, и
-- доверять ему нельзя.
drop policy if exists "chat-images write own" on storage.objects;
create policy "chat-images write own" on storage.objects
  for insert with check (
    bucket_id = 'chat-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "post-images write own" on storage.objects;
create policy "post-images write own" on storage.objects
  for insert with check (
    bucket_id = 'post-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 7. Уборка за удалёнными данными
-- ---------------------------------------------------------------------------
-- Прежде объект хранилища не удалялся НИКОГДА: ни при удалении записи, ни при
-- отмене сообщения, ни при удалении аккаунта. Фотографии оставались на сервере
-- и — при публичном бакете — оставались доступны. Теперь бакеты закрыты, и
-- висящий объект уже не утекает, но хранить его вечно всё равно неправильно:
-- право на удаление означает фактическое удаление, а не потерю ссылки.
--
-- Удалять файл прямо из триггера нельзя: расширение storage не даёт SQL-доступа
-- к содержимому бакета, а http-вызов из триггера — плохая идея (он выполнялся
-- бы внутри транзакции пользователя и мог её подвесить). Поэтому триггер лишь
-- отмечает объект к удалению, а выносит его отдельный проход.
create table if not exists public.storage_cleanup_queue (
  id         bigserial primary key,
  bucket     text not null check (bucket in ('chat-images', 'post-images', 'dm-media')),
  path       text not null,
  reason     text,
  created_at timestamptz not null default now(),
  unique (bucket, path)
);

alter table public.storage_cleanup_queue enable row level security;
-- Политик нет намеренно: очередь читает и чистит только сервер под
-- service_role, которому RLS не писан. Клиенту она не нужна ни в каком виде.

create or replace function public.enqueue_storage_cleanup(p_bucket text, p_path text, p_reason text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.storage_cleanup_queue (bucket, path, reason)
  select p_bucket, p_path, p_reason
  where p_path is not null and p_path <> ''
  on conflict (bucket, path) do nothing;
$$;

revoke all on function public.enqueue_storage_cleanup(text, text, text) from public, anon, authenticated;

create or replace function public.queue_post_image_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Удаление записи и замена картинки при правке — оба случая оставляют
  -- осиротевший файл.
  if tg_op = 'DELETE' then
    perform public.enqueue_storage_cleanup('post-images', old.image_path, 'post deleted');
  elsif old.image_path is distinct from new.image_path then
    perform public.enqueue_storage_cleanup('post-images', old.image_path, 'post image replaced');
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists posts_image_cleanup on public.posts;
create trigger posts_image_cleanup
  after update or delete on public.posts
  for each row execute function public.queue_post_image_cleanup();

create or replace function public.queue_message_image_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.enqueue_storage_cleanup('chat-images', old.image_path, 'message deleted');
    if old.media ? 'path' then
      perform public.enqueue_storage_cleanup('dm-media', old.media->>'path', 'message deleted');
    end if;
  elsif old.unsent_at is null and new.unsent_at is not null then
    -- Отмена сообщения обнуляет image_url и media, поэтому путь берём из OLD.
    perform public.enqueue_storage_cleanup('chat-images', old.image_path, 'message unsent');
    if old.media ? 'path' then
      perform public.enqueue_storage_cleanup('dm-media', old.media->>'path', 'message unsent');
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists messages_image_cleanup on public.messages;
create trigger messages_image_cleanup
  after update or delete on public.messages
  for each row execute function public.queue_message_image_cleanup();

comment on table public.storage_cleanup_queue is
  'Пути в хранилище, оставшиеся без владеющей строки. Разбирает серверный проход под service_role; RLS-политик нет намеренно.';
