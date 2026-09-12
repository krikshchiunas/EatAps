-- ═══════════════════════════════════════════════════════════════════════════
-- EatAps — ограничение частоты, которое переживает бессерверную платформу.
--
-- ЧТО БЫЛО НЕ ТАК
--
-- В api/feedback.js лимит жил в памяти процесса:
--
--     const hits = new Map()
--
-- На Vercel экземпляров функции много, они создаются под нагрузкой и умирают.
-- Общей памяти между ними нет, поэтому счётчик обнулялся сам собой, а
-- параллельные запросы попадали в РАЗНЫЕ экземпляры и не видели друг друга.
-- Автор честно описал это в комментарии, но заслон от этого работать не начал.
--
-- Вторая половина беды: ключом был первый элемент X-Forwarded-For, то есть
-- значение из заголовка запроса. Подставив свой, можно было получить сколько
-- угодно свежих корзин.
--
-- ЧТО ВВОДИТСЯ
--
-- Одна общая таблица счётчиков и одна функция. Намеренно НЕ Redis и не внешний
-- сервис: для нескольких обращений в минуту отдельный поставщик — лишняя
-- зависимость, лишние деньги и лишняя точка отказа, а Postgres уже есть.
--
-- Окно фиксированное (не скользящее). Для защиты от потока это достаточно:
-- на границе окон в худшем случае проходит удвоенный лимит, что на порядки
-- лучше отсутствия лимита. Скользящее окно потребовало бы хранить каждую
-- попытку отдельно — дороже без практической разницы.
--
-- КЛЮЧ ХРАНИТСЯ ХЭШЕМ. По ключу может прийти IP-адрес, а это персональные
-- данные: складывать их в открытую ради счётчика не нужно. Хэш решает ту же
-- задачу (различить обратившихся), но не даёт обратного прочтения.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.rate_limits (
  bucket       text        not null,
  key_hash     text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (bucket, key_hash, window_start)
);

alter table public.rate_limits enable row level security;
-- Политик нет намеренно: таблицу трогает только сервер под service_role.
-- Клиенту нельзя ни читать (это разведка чужой активности), ни писать.

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- Одно обращение к лимиту
-- ---------------------------------------------------------------------------
-- Возвращает jsonb: { allowed, hits, limit, reset_at, retry_after }.
--
-- Проверка и увеличение — один оператор: иначе два одновременных запроса
-- прочитали бы одно и то же значение и оба прошли бы (ровно та ошибка, что
-- была в учёте AI).
--
-- Сам лимитер не должен становиться способом положить базу, поэтому:
--   • строк ровно по числу активных корзин, а не по числу попыток;
--   • старые окна убираются здесь же, изредка и небольшими порциями.
create or replace function public.rate_limit_hit(
  p_bucket text,
  p_key    text,
  p_limit  integer,
  p_window interval default interval '1 minute'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds numeric := greatest(1, extract(epoch from p_window));
  v_start   timestamptz;
  v_hits    integer;
begin
  if p_bucket is null or p_key is null or p_key = '' then
    raise exception 'bucket and key are required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'limit must be positive' using errcode = '22023';
  end if;

  -- Начало текущего окна: время, округлённое вниз до размера окна.
  v_start := to_timestamp(floor(extract(epoch from now()) / v_seconds) * v_seconds);

  insert into public.rate_limits (bucket, key_hash, window_start, hits)
  values (p_bucket, md5(p_bucket || ':' || p_key), v_start, 1)
  on conflict (bucket, key_hash, window_start) do update
    set hits = public.rate_limits.hits + 1
  returning hits into v_hits;

  -- Уборка прошлых окон. Раз примерно на сотню обращений и не больше тысячи
  -- строк за раз: полная чистка под нагрузкой сама стала бы помехой.
  if random() < 0.01 then
    delete from public.rate_limits
     where ctid in (
       select ctid from public.rate_limits
        where window_start < now() - interval '1 day'
        limit 1000
     );
  end if;

  return jsonb_build_object(
    'allowed', v_hits <= p_limit,
    'hits', v_hits,
    'limit', p_limit,
    'reset_at', v_start + p_window,
    'retry_after', greatest(1, ceil(extract(epoch from (v_start + p_window) - now())))
  );
end;
$$;

revoke all on function public.rate_limit_hit(text, text, integer, interval) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, integer, interval) to service_role;

comment on table public.rate_limits is
  'Счётчики частоты обращений. Ключ хранится хэшем: по нему может приходить IP-адрес.';
