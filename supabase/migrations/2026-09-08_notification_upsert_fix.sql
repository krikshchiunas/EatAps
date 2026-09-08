-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — второе сообщение человеку не отправлялось.
--
-- Запускать в Supabase SQL Editor ПОСЛЕ всех предыдущих миграций.
-- Идемпотентно. Данные не трогает.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ЧТО БЫЛО СЛОМАНО
--
-- Отправка сообщения падала с
--   P0001: only read_at can be updated
-- и человек видел «! повторить» под своим сообщением. Причём выборочно: одним
-- собеседникам написать можно, другим — нет, и объяснить разницу было нечем.
--
-- Механика. Вставка сообщения дёргает триггер messages_notify, тот зовёт
-- push_notification, а она делает upsert в notifications:
--
--     on conflict (recipient_id, actor_id, type, entity_id)
--       where entity_id is not null
--     do update set created_at = now(), read_at = null, metadata = excluded.metadata;
--
-- Замысел верный: одно и то же событие («в этом диалоге есть новое») — одна
-- строка, которая поднимается наверх и снова становится непрочитанной.
--
-- Но на ветке DO UPDATE срабатывает BEFORE UPDATE-триггер той же таблицы, а он
-- с 2026-08-25 запрещал менять всё, кроме read_at, — включая created_at и
-- metadata, которые этот upsert как раз и меняет. Сервер сам себе запрещал
-- запись, исключение уносило всю транзакцию, и сообщение не сохранялось.
--
-- ПОЧЕМУ ЭТО ВЫГЛЯДЕЛО КАК «НЕ МОГУ ПИСАТЬ ТОЛЬКО ЕМУ». Первое сообщение
-- проходит: строки уведомления ещё нет, срабатывает INSERT, а на нём
-- BEFORE UPDATE-триггера нет. Ломается ВТОРОЕ и все следующие — но только
-- пока строка уведомления жива. Стоит собеседнику открыть приложение и
-- разобрать события, строка исчезает, и переписка снова работает.
--
-- То есть отправка ломалась ровно к тем, кто давно не заходил. Именно это и
-- сбивало с толку: с активными собеседниками всё работало.
--
-- ЭТО НЕ РЕГРЕССИЯ 2026-09-07. Ошибка живёт с 2026-08-25, просто до открытия
-- переписки всем её встречали реже.
--
-- ───────────────────────────────────────────────────────────────────────────
-- КАК ЧИНИМ
--
-- Не ослаблением guard'а. Его смысл остаётся прежним и нужным: ПОЛУЧАТЕЛЬ не
-- должен уметь переписать содержимое события — политика «notifications mark
-- read» разрешает ему UPDATE строки без разбора по колонкам, и единственное,
-- что мешает подменить actor_id или текст, это триггер.
--
-- Различаем законную серверную запись явным признаком — тем же приёмом, что
-- уже применён к profiles в 2026-09-05 §11.1. Полагаться на auth.uid() здесь
-- нельзя: SECURITY DEFINER меняет роль, но не JWT, и внутри push_notification
-- auth.uid() — это по-прежнему тот, кто отправил сообщение.
--
-- Признак транзакционный (третий аргумент set_config = true): он не переживает
-- запрос и не может утечь на соседний через пул соединений.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.push_notification(
  p_recipient   uuid,
  p_actor       uuid,
  p_type        public.notification_type,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;
  if p_actor is not null and public.is_blocked_between(p_recipient, p_actor) then
    return;
  end if;

  -- Признак снимается и в случае ошибки: он транзакционный, и откат
  -- транзакции уносит его вместе с собой.
  perform set_config('eataps.trusted_notification_write', 'on', true);

  insert into public.notifications
    (recipient_id, actor_id, type, entity_type, entity_id, metadata)
  values
    (p_recipient, p_actor, p_type, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  on conflict (recipient_id, actor_id, type, entity_id)
    where entity_id is not null
  do update set created_at = now(), read_at = null, metadata = excluded.metadata;

  perform set_config('eataps.trusted_notification_write', 'off', true);
end;
$$;

revoke all on function public.push_notification(uuid, uuid, public.notification_type, text, uuid, jsonb)
  from public, anon, authenticated;


-- Guard остаётся ровно таким же строгим для клиента и пропускает только
-- запись, помеченную самим сервером.
create or replace function public.guard_notification_update()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('eataps.trusted_notification_write', true), 'off') = 'on' then
    return new;
  end if;

  if new.recipient_id is distinct from old.recipient_id
     or new.actor_id    is distinct from old.actor_id
     or new.type        is distinct from old.type
     or new.entity_type is distinct from old.entity_type
     or new.entity_id   is distinct from old.entity_id
     or new.metadata    is distinct from old.metadata
     or new.created_at  is distinct from old.created_at then
    raise exception 'only read_at can be updated';
  end if;
  return new;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────
-- Разовая чистка залипших событий
-- ─────────────────────────────────────────────────────────────────────────
-- Пока баг был жив, уведомление о новом сообщении переставало обновляться:
-- строка осталась от самого первого сообщения, а все последующие до неё не
-- доходили. Поэтому у части людей в центре событий висит «вам написали» с
-- датой месячной давности, хотя переписка шла и позже.
--
-- Чинить пересчётом не будем — правильную дату всё равно взять неоткуда, а
-- сам счётчик непрочитанных считается по messages.read_at, а не по этим
-- строкам. Просто подтягиваем время события к последнему сообщению в
-- диалоге: так переход из уведомления ведёт туда же, куда и раньше, но
-- список событий перестаёт врать о времени.
-- Признак ставим и здесь: этот UPDATE меняет created_at, то есть упирается
-- ровно в тот триггер, который чиним. Третий аргумент false — на всю сессию,
-- потому что это отдельный оператор верхнего уровня, а не тело функции.
select set_config('eataps.trusted_notification_write', 'on', false);

update public.notifications n
   set created_at = m.last_at
  from (
    select recipient, sender, max(created_at) as last_at
    from public.messages
    group by recipient, sender
  ) m
 where n.type = 'MESSAGE'
   and n.recipient_id = m.recipient
   and n.actor_id     = m.sender
   and n.entity_id    = m.sender
   and n.created_at < m.last_at;

select set_config('eataps.trusted_notification_write', 'off', false);
