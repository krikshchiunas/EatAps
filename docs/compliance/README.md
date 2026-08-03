# EatAps — Compliance (DSGVO / DDG)

> Что готово технически и что требуется от тебя, чтобы быть «чистым по закону Германии».
> ⚠️ Это не юридическая консультация. Финальная проверка — у юриста по Datenschutz.

## ✅ Уже реализовано (код/техника)
- HTTPS + HSTS, security-заголовки (CSP, X-Frame-Options, nosniff, Referrer/Permissions-Policy) — оценка B+/A.
- Row Level Security: каждый видит только свои данные; данные друга — только при подтверждённой дружбе.
- Экспорт своих данных (JSON) и удаление аккаунта (`delete_current_user`, каскадно) — прямо в приложении.
- Шаблоны **Impressum + Datenschutzerklärung + AGB** в приложении (Профиль → Impressum/Datenschutz/AGB).
- Только essential-localStorage, без трекинг-куки и аналитики.
- Шаблоны внутренних документов: `verzeichnis-verarbeitungstaetigkeiten.md`, `tom.md`, `datenpannen-plan.md`, `avv-checkliste.md`.

## 🟡 Осталось от тебя — по шагам

### Шаг 1. Заполнить правовые тексты (обязательно)
В `src/components/LegalSheet.jsx` заменить все `[плейсхолдеры]`: имя/название, адрес, e-mail, регион Supabase, надзорный орган, дату. (Или скажи мне значения — подставлю.)

### Шаг 2. Юрист (обязательно)
Дать Impressum, Datenschutz и AGB на проверку юристу по Datenschutz (health-данные = ст. 9, строгие требования). Альтернатива для черновика: генераторы eRecht24 / Dr. Schwenke, но ревью юриста всё равно нужно.

### Шаг 3. Договоры с обработчиками — AVV/DPA (обязательно)
По `avv-checkliste.md`: принять DPA у Vercel, Supabase, Google, Reown. **Поставить регион Supabase = EU (Frankfurt).**

### Шаг 4. Настройки Supabase (безопасность)
- Auth → включить подтверждение e-mail, **Leaked password protection**, rate-limits.
- Включить 2FA на аккаунтах Supabase / Vercel / GitHub / Google.
- Проверить/включить backups.

### Шаг 5. Домены (redirect-allowlist)
- Supabase → Authentication → URL Configuration: Site URL + Redirect URLs = актуальный домен (+ localhost).
- cloud.reown.com → Allowed Domains = актуальный домен.

### Шаг 6. Внутренние документы
Заполнить и хранить у себя: `verzeichnis-verarbeitungstaetigkeiten.md`, `tom.md`, `datenpannen-plan.md`.

### Шаг 7. Проверить особые триггеры (с юристом)
- **DPIA (Art. 35)** — при health-данных в масштабе часто обязательна.
- **DPO (Datenschutzbeauftragter)** — нужен ли (обычно для соло-проекта нет).
- **Возраст <16** — согласие родителей (Art. 8). В приложении добавится возрастная проверка при согласии.

## 🔧 Что мне (ассистенту) осталось дописать в коде
- **Явная галочка согласия** при входе/регистрации (сейчас там пассивная формулировка «продолжая, вы соглашаетесь» — для health-данных нужна активная галочка). Придержано: файл `AuthSheet.jsx` в активной правке другого сеанса; добавлю, как только он закоммитит.
- **Возрастная проверка** (<16 → согласие родителей) при регистрации — добавлю вместе с consent-галочкой.
