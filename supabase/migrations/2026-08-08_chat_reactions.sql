-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — реакция на сообщение в чате (двойной тап → 🥕).
--
-- Запускать в Supabase SQL Editor ПОСЛЕ предыдущих миграций.
-- Идемпотентно, данные не трогает.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Колонка реакций
-- ─────────────────────────────────────────────────────────────────────────
-- {user_id: emoji} — в 1-на-1 чате ключей максимум два (отправитель и
-- получатель), поэтому отдельный лимит размера не нужен: объект физически не
-- может разрастись.
alter table public.messages
  add column if not exists reactions jsonb not null default '{}'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Переключение реакции — единственный штатный путь записи
-- ─────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER: обходит RLS так же, как mark_messages_read. Проверка
-- участника — вручную внутри функции, по auth.uid(). Реакция ограничена одним
-- разрешённым значением намеренно: это не открытый ввод текста в приватное
-- поле, а фиксированный набор из одного эмодзи (морковка). Расширить набор
-- позже — значит расширить список допустимых значений здесь и в guard-триггере
-- ниже, а не открывать поле нараспашку.
--
-- Переключение делает СЕРВЕР, а не клиент: клиент всегда просит «переключить
-- на 🥕», а прочитает ли он это как «добавить» или «убрать» — решает текущее
-- состояние строки на сервере. Так двойной тап с двух устройств почти
-- одновременно не может рассинхронизировать результат сильнее, чем на один
-- лишний клик, который тут же поправит realtime-событие.
create or replace function public.toggle_message_reaction(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_row public.messages%rowtype;
  v_next jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_emoji is distinct from '🥕' then
    raise exception 'unsupported reaction' using errcode = '22023';
  end if;

  select * into v_row from public.messages where id = p_message_id for update;
  if not found then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if v_uid <> v_row.sender and v_uid <> v_row.recipient then
    raise exception 'not a participant of this conversation' using errcode = '42501';
  end if;

  v_key := v_uid::text;
  if v_row.reactions->>v_key = p_emoji then
    v_next := v_row.reactions - v_key;
  else
    v_next := jsonb_set(v_row.reactions, array[v_key], to_jsonb(p_emoji), true);
  end if;

  update public.messages set reactions = v_next where id = p_message_id;
  return v_next;
end;
$$;

revoke all on function public.toggle_message_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Guard-триггер: получателю можно менять ТОЛЬКО свой ключ реакции
-- ─────────────────────────────────────────────────────────────────────────
-- RLS у "messages mark read" разрешает получателю UPDATE строки без разбора
-- по колонкам — единственное, что раньше ограничивало его правки, это guard-
-- триггер (список разрешённых полей: только read_at). Если просто добавить
-- reactions в список разрешённых полей, получатель сможет обойти RPC выше и
-- отправить произвольный UPDATE напрямую через клиент — с любым текстом под
-- любым ключом, включая ключ отправителя. Поэтому здесь не "разрешить менять
-- reactions", а точечно: разрешить менять ТОЛЬКО собственный ключ и только на
-- разрешённое значение — тогда даже прямой запрос в обход RPC ничего лишнего
-- сделать не сможет.
--
-- Сторона отправителя отдельной проверки не требует: для неё нет RLS-политики
-- UPDATE вообще, прямой запрос от отправителя отклоняется на уровне RLS раньше,
-- чем дойдёт до этого триггера — правки от его имени идут только через RPC.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
as $$
declare
  v_key text := auth.uid()::text;
begin
  if auth.uid() = old.recipient and auth.uid() <> old.sender then
    if new.text            is distinct from old.text
       or new.image_url    is distinct from old.image_url
       or new.meal_ref     is distinct from old.meal_ref
       or new.sender       is distinct from old.sender
       or new.recipient    is distinct from old.recipient
       or new.created_at   is distinct from old.created_at
       or new.reply_to     is distinct from old.reply_to
       or new.reply_snapshot  is distinct from old.reply_snapshot
       or new.forwarded_name  is distinct from old.forwarded_name then
      raise exception 'Only read_at and own reaction can be updated by the recipient';
    end if;
    if new.read_at is null and old.read_at is not null then
      raise exception 'read_at cannot be cleared';
    end if;
    if new.reactions is distinct from old.reactions then
      if (old.reactions - v_key) is distinct from (new.reactions - v_key) then
        raise exception 'Only your own reaction key can change';
      end if;
      if new.reactions ? v_key and new.reactions->>v_key is distinct from '🥕' then
        raise exception 'unsupported reaction';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Realtime
-- ─────────────────────────────────────────────────────────────────────────
-- messages уже в публикации supabase_realtime (см. schema.sql) — публикация
-- задана на уровне таблицы, новая колонка доезжает автоматически, отдельного
-- шага не требует. Строка ниже на случай, если кто-то прогоняет только этот
-- файл на пустой базе.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end $$;
