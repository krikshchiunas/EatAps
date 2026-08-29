#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Настройка вебхука телеграм-бота модерации — один раз на проект.
#
# TG_WEBHOOK_SECRET нигде не «находится»: это пароль, который вы придумываете.
# Телеграм присылает его в заголовке X-Telegram-Bot-Api-Secret-Token на каждом
# обновлении, а api/telegram/webhook.js сверяет и отбрасывает чужие запросы.
# Без него вебхук намеренно отвечает 503: открытый эндпоинт модерации хуже
# нерабочего.
#
# Секрет нужно знать ОБЕИМ сторонам. В Vercel он хранится как sensitive и назад
# не читается, поэтому обе стороны настраиваются здесь за один проход — иначе
# значения разъедутся и вебхук будет отдавать 403.
#
# Скрипт НЕ выкладывает вашу рабочую копию в прод: он пересобирает последний
# уже выложенный прод-деплой, чтобы тот подхватил новую переменную. Незакоммиченные
# правки в прод не попадут.
#
# Запуск:  bash scripts/setup-telegram.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

URL="${WEBHOOK_URL:-https://www.eataps.com/api/telegram/webhook}"

need() { command -v "$1" >/dev/null || { echo "нет команды $1"; exit 1; }; }
need vercel; need curl

echo "▸ Шаг 1. Придумываем секрет"
# Телеграм разрешает 1–256 символов из A-Z a-z 0-9 _ и -.
SECRET="$(LC_ALL=C tr -dc 'A-Za-z0-9_-' </dev/urandom | head -c 48)"
echo "  сгенерирован, 48 символов (на экран не выводим)"

echo
echo "▸ Шаг 2. Кладём в окружение Vercel (Production и Preview)"
for ENVNAME in production preview; do
  printf '%s' "$SECRET" \
    | vercel env add TG_WEBHOOK_SECRET "$ENVNAME" --sensitive --force --yes >/dev/null
  echo "  ✓ $ENVNAME"
done

echo
echo "▸ Шаг 3. Пересобираем последний прод-деплой"
echo "  (переменные подхватываются только при сборке; ваша рабочая копия не выкладывается)"
LAST="$(vercel ls --prod 2>/dev/null | grep -o 'https://[a-z0-9.-]*\.vercel\.app' | head -1)"
if [ -z "$LAST" ]; then
  echo "  не нашёл прошлый прод-деплой — запустите вручную: vercel redeploy <url> --target production"
  exit 1
fi
vercel redeploy "$LAST" --target production >/dev/null
echo "  ✓ пересобран"

echo
echo "▸ Шаг 4. Сообщаем тот же секрет Телеграму"
echo "  Токен бота — у @BotFather: /mybots → ваш бот → API Token."
read -rsp "  Вставьте токен бота (ввод скрыт): " TG_TOKEN
echo
RESP="$(curl -sS -F "url=$URL" -F "secret_token=$SECRET" \
  "https://api.telegram.org/bot${TG_TOKEN}/setWebhook")"
echo "  Телеграм ответил: $RESP"

echo
echo "▸ Проверка"
curl -sS "https://api.telegram.org/bot${TG_TOKEN}/getWebhookInfo" | tr ',' '\n' | grep -i 'url\|error\|pending' || true
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$URL")"
echo
echo "  Чужой POST без секрета → $CODE"
case "$CODE" in
  403) echo "  ✓ готово: секрет на месте, посторонние отсекаются" ;;
  503) echo "  ✗ переменная ещё не доехала — подождите конца сборки и повторите проверку" ;;
  *)   echo "  ? неожиданный ответ, посмотрите логи функции в Vercel" ;;
esac
