# EatAps

Персональная система управления питанием (PWA). React + Vite, local-first, синхронизация через Supabase.

## Запуск локально

```bash
npm install
npm run dev
```

Без ключей Supabase приложение работает офлайн (данные только на устройстве). Чтобы включить аккаунты и синхронизацию — см. ниже.

## Подключение Supabase (аккаунты + облако)

1. Создайте проект на https://supabase.com
2. **SQL Editor** → вставьте содержимое [`supabase/schema.sql`](supabase/schema.sql) → **Run**. Это создаст таблицу `app_state` с защитой доступа (RLS).
3. **SQL Editor** → следом выполните миграции по порядку. Оба файла обязательны
   и их можно прогонять повторно:
   - [`migrations/2026-08-06_account_sync.sql`](supabase/migrations/2026-08-06_account_sync.sql) —
     версионирование состояния (`revision` + запись только через `save_app_state`),
     `presence` вместо `app_state.last_seen`, Realtime для `app_state`. Без него
     правки, сделанные на двух устройствах одновременно, затирают друг друга.
   - [`migrations/2026-08-07_friend_privacy.sql`](supabase/migrations/2026-08-07_friend_privacy.sql) —
     друг получает только то, что показано на экране (имя, фото, био, любимые
     места, норма калорий, дневник), а не всю строку состояния с весом, ростом
     и возрастом. Плюс самолечение публичного ID.
     **Порядок:** сначала деплой фронтенда, потом этот файл — старый фронтенд
     после смены политики покажет карточку друга пустой.
   - [`migrations/2026-08-08_hardening.sql`](supabase/migrations/2026-08-08_hardening.sql) —
     устранение слабостей аудита: имя в заявке в друзья ставит сервер (его
     нельзя подделать), ограничения на размер состояния, на размер и тип
     загружаемых фото, на частоту заявок в друзья.
   - [`migrations/2026-08-08_chat_reactions.sql`](supabase/migrations/2026-08-08_chat_reactions.sql) —
     реакция на сообщение в чате (двойной тап → 🥕). Переключение делает
     сервер (RPC `toggle_message_reaction`), получателю разрешено менять
     только собственный ключ реакции — даже прямой запрос в обход RPC не
     допишет реакцию под чужим именем.
4. **SQL Editor** → [`supabase/verify.sql`](supabase/verify.sql) — самопроверка,
   38 пунктов, только чтение. Все строки должны быть ✔.
5. **Project Settings → API** → скопируйте `Project URL` и `anon public` ключ.
6. Локально: создайте `.env.local` (см. `.env.example`):
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
7. `npm run dev` — в разделе «Профиль» появится вход.

### Настройка входов (по желанию)

- **Email + пароль** и **Magic link** — работают сразу (Supabase → Authentication → Providers → Email).
- **Google** — Supabase → Authentication → Providers → Google: добавьте Client ID/Secret из Google Cloud OAuth.
- **Apple** — Supabase → Providers → Apple (нужен Apple Developer аккаунт, Service ID, ключ).
- **Телефон (SMS)** — Supabase → Providers → Phone: подключите SMS-провайдера (Twilio и т.п., платно).
- **Redirect URLs** — Authentication → URL Configuration → добавьте `http://localhost:5173` и адрес продакшена (`https://ваш-проект.vercel.app`).

## Деплой на Vercel (через GitHub)

1. Залейте репозиторий на GitHub:
   ```bash
   git remote add origin https://github.com/USERNAME/eataps.git
   git push -u origin main
   ```
2. На https://vercel.com → **Add New → Project** → импортируйте репозиторий. Framework определится как **Vite** автоматически.
3. В **Environment Variables** добавьте `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`.
4. **Deploy**. Каждый `git push` будет обновлять сайт автоматически.
5. Добавьте адрес `https://ваш-проект.vercel.app` в Supabase → Authentication → URL Configuration.
