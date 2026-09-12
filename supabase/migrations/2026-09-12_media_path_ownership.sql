-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — путь вложения обязан принадлежать тому, кто его приложил.
--
-- ⚠ ЭТА МИГРАЦИЯ ЗАКРЫВАЕТ ДЫРУ, ОТКРЫТУЮ МИГРАЦИЕЙ 2026-09-12_private_media.
-- Она обязана применяться вместе с ней. Ниже подробно, в чём было дело, —
-- ошибка неочевидная, и повторить её легко.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ЧТО БЫЛО НЕ ТАК
--
-- Предикат чтения выглядел так:
--
--     select exists (
--       select 1 from public.messages m
--       where m.image_path = p_name
--         and (m.sender = auth.uid() or m.recipient = auth.uid() or …)
--     )
--
-- Читается он как «файл виден участнику сообщения, к которому приложен». Но
-- КТО задаёт `image_url`, из которого выводится `image_path`? Клиент:
-- send_conversation_message принимает p_image_url параметром и кладёт как есть.
--
-- Значит нападающий может отправить сообщение САМОМУ СЕБЕ, подставив в
-- image_url чужой путь:
--
--     .../object/public/chat-images/<чужой-uuid>/<файл>.jpg
--
-- Он — отправитель этого сообщения, условие выполняется, и политика выдаёт
-- подписанную ссылку на ЧУЖОЕ фото. Проверка «ты участник сообщения» ничего
-- не значит, если сообщение сочинил сам нападающий.
--
-- Вторая половина беды — уборка. Триггеры складывали `image_path` удалённого
-- сообщения в очередь, а разбирает её сервер под service_role, которому RLS не
-- писан. То есть та же подделка позволяла УДАЛИТЬ чужой файл: приложить чужой
-- путь к своему сообщению и удалить сообщение.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ПОЧЕМУ ЧИНИТСЯ ИМЕННО ТАК
--
-- Путь файла не произволен — его задаёт загрузка, и в нём уже записан владелец:
--
--     chat-images / post-images : <id владельца>/<uuid>.<ext>
--     dm-media                  : <id диалога>/<id автора>/<uuid>.<ext>
--
-- Политика записи в хранилище это и проверяет: положить файл можно только в
-- свою папку. Значит первый (для dm-media — второй) сегмент пути — достоверное
-- утверждение о том, кто файл загрузил.
--
-- Отсюда правило: путь засчитывается, только если его сегмент владельца
-- совпадает с автором строки, которая на него ссылается. Подделка перестаёт
-- работать сама собой — чужой путь несёт чужой идентификатор.
--
-- Никаких новых таблиц и колонок: проверка опирается на то, что уже записано
-- в самом пути.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 1. Владелец пути
-- ---------------------------------------------------------------------------
-- Вынесено отдельной функцией, чтобы одно и то же правило не было переписано
-- в четырёх местах и не разъехалось между ними.
create or replace function public.media_path_owner(p_path text, p_segment int default 1)
returns text
language sql
immutable
as $$
  select case
    when p_path is null or p_path = '' then null
    -- split_part вернёт пустую строку, если сегмента нет вовсе; такой путь
    -- не принадлежит никому и не должен совпасть ни с одним идентификатором.
    when nullif(split_part(p_path, '/', p_segment), '') is null then null
    else split_part(p_path, '/', p_segment)
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Чтение вложений переписки
-- ---------------------------------------------------------------------------
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
      -- ⚠ КЛЮЧЕВАЯ СТРОКА. Без неё достаточно приложить чужой путь к своему
      -- сообщению, чтобы получить подпись на чужой файл.
      and public.media_path_owner(m.image_path) = m.sender::text
      and (
        m.sender = auth.uid()
        or m.recipient = auth.uid()
        or (m.conversation_id is not null
            and public.is_conversation_member(m.conversation_id, auth.uid()))
      )
      -- Блокировка перекрывает участие — как и в политике чтения сообщений.
      and not public.is_blocked_between(m.sender, auth.uid())
  );
$$;

revoke all on function public.can_read_chat_image(text) from public, anon;
grant execute on function public.can_read_chat_image(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Чтение изображений записей
-- ---------------------------------------------------------------------------
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
      -- То же самое: своя запись с чужим путём не даёт доступа к чужому файлу.
      and public.media_path_owner(p.image_path) = p.user_id::text
      and public.can_view_post(p.id)
  );
$$;

revoke all on function public.can_read_post_image(text) from public, anon;
grant execute on function public.can_read_post_image(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Уборка удаляет только свои файлы
-- ---------------------------------------------------------------------------
-- Здесь проверка нужна не меньше, чем на чтении: очередь разбирает сервер под
-- service_role, для которого политик хранилища не существует. Без неё подделка
-- пути превращалась в удаление чужого файла.
create or replace function public.queue_post_image_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  v_path := old.image_path;
  -- Путь, не принадлежащий автору записи, в очередь не попадает вовсе.
  if v_path is null or public.media_path_owner(v_path) is distinct from old.user_id::text then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    perform public.enqueue_storage_cleanup('post-images', v_path, 'post deleted');
  elsif old.image_path is distinct from new.image_path then
    perform public.enqueue_storage_cleanup('post-images', v_path, 'post image replaced');
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.queue_message_image_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_img   text;
  v_media text;
  v_drop  boolean;
begin
  v_drop := tg_op = 'DELETE'
    or (old.unsent_at is null and new.unsent_at is not null);
  if not v_drop then
    return coalesce(new, old);
  end if;

  -- chat-images: путь начинается с папки загрузившего.
  v_img := old.image_path;
  if v_img is not null and public.media_path_owner(v_img) = old.sender::text then
    perform public.enqueue_storage_cleanup('chat-images', v_img, 'message removed');
  end if;

  -- dm-media: <id диалога>/<id автора>/<файл>. Проверяем ОБА сегмента —
  -- иначе можно было бы удалить файл соседнего диалога.
  if old.media ? 'path' then
    v_media := old.media->>'path';
    if v_media is not null
       and public.media_path_owner(v_media, 2) = old.sender::text
       and (old.conversation_id is null
            or public.media_path_owner(v_media, 1) = old.conversation_id::text)
    then
      perform public.enqueue_storage_cleanup('dm-media', v_media, 'message removed');
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

-- Триггеры пересоздаём: тела функций заменены через create or replace, но
-- пересоздание делает связь явной и переживает переименование в будущем.
drop trigger if exists posts_image_cleanup on public.posts;
create trigger posts_image_cleanup
  after update or delete on public.posts
  for each row execute function public.queue_post_image_cleanup();

drop trigger if exists messages_image_cleanup on public.messages;
create trigger messages_image_cleanup
  after update or delete on public.messages
  for each row execute function public.queue_message_image_cleanup();

-- ---------------------------------------------------------------------------
-- 5. Разовая чистка очереди от уже подделанного
-- ---------------------------------------------------------------------------
-- Если между применением 2026-09-12_private_media и этой миграцией кто-то
-- успел подложить чужой путь, он уже лежит в очереди и будет удалён первым же
-- проходом уборки. Выметаем всё, чей владелец не подтверждается строкой-
-- источником. Записи, подтверждённые источником, остаются.
delete from public.storage_cleanup_queue q
where q.bucket in ('chat-images', 'post-images')
  and not exists (
    select 1 from public.posts p
    where q.bucket = 'post-images'
      and p.image_path = q.path
      and public.media_path_owner(p.image_path) = p.user_id::text
  )
  and not exists (
    select 1 from public.messages m
    where q.bucket = 'chat-images'
      and m.image_path = q.path
      and public.media_path_owner(m.image_path) = m.sender::text
  );

comment on function public.media_path_owner(text, int) is
  'Идентификатор владельца, записанный в пути файла. Политика записи в хранилище гарантирует, что положить файл можно только в свою папку, — поэтому этому сегменту можно верить.';
