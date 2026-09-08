-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — самопроверка после 2026-09-09_conversations.
--
-- Вставить целиком в Supabase SQL Editor → Run. Ничего не меняет, только читает.
--
-- ⚠ Выполняется от service_role, для которого RLS не применяется: проверяет
-- существование и согласованность, но НЕ изоляцию. Ручная матрица — в конце.
-- ═══════════════════════════════════════════════════════════════════════════

with checks(порядок, проверка, ok, деталь) as (

  -- ── 1. Структура ────────────────────────────────────────────────────────
  select 1, 'таблица conversations существует',
    to_regclass('public.conversations') is not null,
    coalesce((select count(*) filter (where kind='direct')::text || ' личных, '
              || count(*) filter (where kind='group')::text || ' групповых'
              from public.conversations), '—')

  union all select 2, 'таблица conversation_members существует',
    to_regclass('public.conversation_members') is not null,
    coalesce((select count(*)::text || ' участий' from public.conversation_members), '—')

  union all select 3, 'таблица message_deletions существует',
    to_regclass('public.message_deletions') is not null,
    '«удалить у себя» переживает смену устройства'

  union all select 4, 'RLS включён на всех таблицах переписки',
    not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and not c.relrowsecurity
        and c.relname in ('conversations','conversation_members','messages',
                          'message_deletions','message_views')
    ),
    'без RLS conversation_id был бы паролем к чужой переписке'

  -- ── 2. Личный диалог не двоится ─────────────────────────────────────────
  union all select 10, 'уникальный индекс по паре участников на месте',
    exists (select 1 from pg_indexes
      where schemaname='public' and indexname='conversations_direct_pair_uniq'),
    'без него гонка при первом сообщении разводит переписку по двум веткам'

  union all select 11, 'нет двух личных диалогов на одну пару',
    not exists (
      select pair_low, pair_high from public.conversations
      where kind='direct' group by pair_low, pair_high having count(*) > 1
    ),
    'дубль означал бы «он отвечает, а я не вижу»'

  union all select 12, 'у личного диалога ровно два участника',
    not exists (
      select 1 from public.conversations c
      where c.kind='direct'
        and (select count(*) from public.conversation_members m
              where m.conversation_id = c.id) <> 2
    ),
    'constraint conversations_pair_shape + состав'

  union all select 13, 'пара личного диалога упорядочена (low < high)',
    exists (select 1 from pg_constraint where conname='conversations_pair_shape'),
    'иначе один и тот же диалог заводился бы дважды в разном порядке'

  -- ── 3. Перенос старой переписки ─────────────────────────────────────────
  union all select 20, 'все сообщения привязаны к диалогу',
    not exists (select 1 from public.messages where conversation_id is null),
    coalesce((select count(*)::text || ' без диалога'
              from public.messages where conversation_id is null), '0')

  union all select 21, 'отправитель личного сообщения — участник диалога',
    not exists (
      select 1 from public.messages m
      where m.conversation_id is not null
        and not exists (
          select 1 from public.conversation_members cm
          where cm.conversation_id = m.conversation_id and cm.user_id = m.sender
        )
    ),
    'сообщение от постороннего в диалоге означало бы дыру в правах'

  union all select 22, 'recipient сохранён у личных сообщений',
    not exists (
      select 1 from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where c.kind='direct' and m.recipient is null
    ),
    'на recipient держится совместимость со старым клиентом'

  union all select 23, 'решения по переписке перенесены в состояние участника',
    not exists (
      select 1 from public.message_grants g
      join public.conversations c
        on c.kind='direct'
       and c.pair_low = least(g.owner_id, g.peer_id)
       and c.pair_high = greatest(g.owner_id, g.peer_id)
      join public.conversation_members m
        on m.conversation_id = c.id and m.user_id = g.owner_id
      where g.state = 'declined' and m.state <> 'declined'
    ),
    'отказ в message_grants и состояние участника не разошлись'

  -- ── 4. Права ────────────────────────────────────────────────────────────
  union all select 30, 'чтение сообщения требует участия в диалоге',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='messages' and cmd='SELECT'
        and qual like '%is_conversation_member%'
    ),
    'знание conversation_id не даёт доступа'

  union all select 31, 'вступить в диалог самому нельзя',
    not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='conversation_members' and cmd='INSERT'
    ),
    'INSERT-политики нет вовсе — состав меняет только RPC'

  union all select 32, 'роль и состояние участника защищены триггером',
    exists (select 1 from pg_trigger where tgname='conversation_members_update_guard'),
    'иначе участник выдал бы себе роль администратора'

  union all select 33, 'диалог виден только участнику',
    exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='conversations' and cmd='SELECT'
        and qual like '%is_conversation_member%'
    ),
    'политика conversations select member'

  union all select 34, 'is_conversation_member — SECURITY DEFINER',
    -- Иначе политика на conversation_members сослалась бы на саму себя и ушла
    -- в бесконечную рекурсию (42P17) — классическая ловушка RLS.
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='is_conversation_member' and p.prosecdef),
    'без DEFINER политика зациклится на 42P17'

  -- ── 5. Действия над сообщением ──────────────────────────────────────────
  union all select 40, 'отзыв сообщения не удаляет строку',
    (select pg_get_functiondef(p.oid) like '%unsent_at = now()%'
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='unsend_message'),
    'на строку ссылаются ответы — удаление осиротило бы цитату'

  union all select 41, 'у отозванных сообщений не осталось содержимого',
    not exists (
      select 1 from public.messages
      where unsent_at is not null
        and (text is not null or image_url is not null or media is not null or meal_ref is not null)
    ),
    'отзыв стирает содержимое, а не прячет его на клиенте'

  union all select 42, 'реакция — одна на человека',
    -- Форма хранения { user_id: emoji }: второй эмодзи того же человека
    -- ЗАМЕНЯЕТ первый по построению, дублю взяться неоткуда.
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='set_message_reaction'),
    'set_message_reaction переключает ключ auth.uid()'

  union all select 43, 'прочтение — указателем, а не UPDATE на каждое сообщение',
    exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='conversation_members'
        and column_name='last_read_at'
    ),
    'в переписке на две тысячи реплик разница в три порядка'

  union all select 44, 'пересылка создаёт новое сообщение',
    (select pg_get_functiondef(p.oid) like '%send_conversation_message%'
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='forward_message'),
    'чужой conversation_id наружу не отдаётся'

  -- ── 6. Группы ───────────────────────────────────────────────────────────
  union all select 50, 'приглашение в группу спрашивает настройку приглашаемого',
    (select pg_get_functiondef(p.oid) like '%group_invites%'
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='can_invite_to_group'),
    'can_invite_to_group читает profiles.group_invites'

  union all select 51, 'состав группы меняет только администратор',
    (select pg_get_functiondef(p.oid) like '%conversation_role%'
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='add_conversation_members'),
    'проверка роли на сервере, а не в интерфейсе'

  union all select 52, 'у каждой группы есть создатель',
    not exists (
      select 1 from public.conversations c
      where c.kind='group'
        and not exists (
          select 1 from public.conversation_members m
          where m.conversation_id=c.id and m.role='owner' and m.left_at is null
        )
    ),
    'выход создателя передаёт роль самому давнему участнику'

  -- ── 7. Хранилище вложений ───────────────────────────────────────────────
  union all select 60, 'бакет dm-media существует и ЗАКРЫТ',
    exists (select 1 from storage.buckets where id='dm-media' and public = false),
    'у вложений личной переписки не должно быть вечного публичного адреса'

  union all select 61, 'чтение вложения требует участия в диалоге',
    exists (
      select 1 from pg_policies
      where schemaname='storage' and tablename='objects'
        and policyname='dm-media read members'
    ),
    'граница стоит на файле, а не на незнании адреса'

  union all select 62, 'у бакета ограничены размер и типы',
    exists (
      select 1 from storage.buckets
      where id='dm-media' and file_size_limit is not null and allowed_mime_types is not null
    ),
    coalesce((select file_size_limit::text || ' байт'
              from storage.buckets where id='dm-media'), '—')

  -- ── 8. Realtime и индексы ───────────────────────────────────────────────
  union all select 70, 'conversation_members в realtime-публикации',
    exists (select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename='conversation_members'),
    'без неё запрос и прочтение не доезжают до второго устройства'

  union all select 71, 'индекс сообщений по диалогу на месте',
    exists (select 1 from pg_indexes
      where schemaname='public' and indexname='messages_conversation_idx'),
    'без него открытие чата читало бы всю таблицу'

  union all select 72, 'индекс участия по человеку на месте',
    exists (select 1 from pg_indexes
      where schemaname='public' and indexname='conversation_members_user_idx'),
    'список диалогов строится по нему'
)
select
  порядок as "№",
  case when ok then '✔' else '✖' end as "статус",
  проверка,
  деталь
from checks
order by порядок;

-- ═══════════════════════════════════════════════════════════════════════════
-- РУЧНАЯ МАТРИЦА ПЕРЕПИСКИ: ТРИ АККАУНТА, НАСТОЯЩИЕ СЕССИИ
--
-- 1. ЗАПРОС НА ПЕРЕПИСКУ
--    C не подписан на B и B не подписан на C.
--    C: select direct_conversation('<B>')              → id диалога
--    C: select send_conversation_message('<id>', 'привет');
--    B: select * from list_conversations_v2('pending') → диалог в запросах
--    B: select * from list_conversations_v2('accepted')→ диалога там НЕТ
--
-- 2. ОТКРЫТИЕ ЗАПРОСА НЕ ЕСТЬ СОГЛАСИЕ
--    B: select * from list_conversation_messages('<id>');  → сообщение видно
--    B: select * from list_conversations_v2('pending')     → всё ещё в запросах
--
-- 3. РЕШЕНИЕ
--    B: select accept_conversation_request('<id>');
--    B: list_conversations_v2('accepted')              → диалог переехал
--    Либо: B: select decline_conversation_request('<id>');
--    C: select send_conversation_message('<id>','ещё') → ошибка 42501
--
-- 4. КВОТА НА НЕПРИНЯТЫЙ ДИАЛОГ
--    C пишет незнакомому шесть раз подряд                → шестое: 54000
--
-- 5. ЧУЖОЙ ДИАЛОГ ПО ЕГО ID
--    A знает id диалога B и C (например, из старого сообщения).
--    A: select * from list_conversation_messages('<id>')   → 0 строк
--    A: select * from messages where conversation_id='<id>'→ 0 строк
--    A: select send_conversation_message('<id>','я тут')   → ошибка 42501
--    A: insert into conversation_members values ('<id>','<A>')  → ошибка RLS
--
-- 6. ГРУППА
--    B: select create_group_conversation('Тест', array['<A>','<C>']);
--       — попадут только те, чей group_invites это разрешает.
--    A: select * from conversation_member_list('<id>')  → состав виден
--    A: select remove_conversation_member('<id>','<C>') → 42501 (A не админ)
--    B: select set_conversation_role('<id>','<A>','admin');
--    A: select remove_conversation_member('<id>','<C>') → теперь можно
--    C: select * from list_conversation_messages('<id>')→ 0 строк после выхода
--
-- 7. ОТЗЫВ И УДАЛЕНИЕ У СЕБЯ
--    A отправляет сообщение, затем: select unsend_message('<mid>');
--    B: list_conversation_messages(...)                 → текста нет, пометка есть
--    B: select delete_message_for_me('<mid2>');
--    B: список                                          → сообщения нет
--    A: список                                          → сообщение НА МЕСТЕ
--
-- 8. ЧУЖОЕ СООБЩЕНИЕ ОТОЗВАТЬ НЕЛЬЗЯ
--    B: select unsend_message('<сообщение A>')          → ошибка 42501
--
-- 9. ПРОЧТЕНИЕ
--    B: select mark_conversation_read('<id>');
--    A: список                                          → read_at проставлен
--    B: select set_read_receipts(false); затем новое сообщение от A
--    B: mark_conversation_read(...)                     → read_at НЕ ставится
--
-- 10. ВЛОЖЕНИЕ ИЗ ЗАКРЫТОГО БАКЕТА
--     A прикрепляет видео в диалоге A↔B (путь <conv>/<A>/файл).
--     C: storage.from('dm-media').createSignedUrl('<путь>')  → отказ
--     B: тот же вызов                                        → ссылка есть
-- ═══════════════════════════════════════════════════════════════════════════
