// ─────────────────────────────────────────────────────────────────────────────
// Тоны ассистента — то, что нужно КЛИЕНТУ: id, подписи на языке интерфейса,
// требует ли тон согласия 18+, и какой тон действует сейчас.
//
// Тексты для модели (persona, примеры реплик, напоминание) живут в
// src/lib/aiPrompt.js и нужны только серверу: в бандл приложения они не
// попадают — ни лишних килобайт, ни промпта на каждом устройстве.
// Список id и optIn здесь и в aiPrompt.js сверяет aiPrompt.test.js.
// ─────────────────────────────────────────────────────────────────────────────
import { t } from './i18n.js'

const tone = (id, optIn = false) => ({
  id,
  optIn,
  get label() { return t(`ai.tone.${id}.label`) },
  get hint() { return t(`ai.tone.${id}.hint`) },
})

export const TONES = Object.freeze({
  calm: tone('calm'),
  buddy: tone('buddy'),
  doctor: tone('doctor'),
  coach: tone('coach'),
  strict: tone('strict'),
  savage: tone('savage', true),
})

export const DEFAULT_TONE = 'calm'

// Тон и согласие живут в prefs — синхронизируются между устройствами вместе с
// остальными настройками. Версия согласия отдельно: если текст предупреждения
// поменяется по сути, поднимаем её, и человек подтверждает заново.
export const TONE_PREF = 'aiTone'
export const TONE_CONSENT_PREF = 'aiToneConsent' // { version, at }
export const TONE_CONSENT_VERSION = 1

export function hasToneConsent(prefs) {
  const c = prefs?.[TONE_CONSENT_PREF]
  return !!c && c.version === TONE_CONSENT_VERSION
}

// Единственный источник правды о том, каким тоном говорить прямо сейчас.
// Тон с опт-ином без действующего согласия молча падает на спокойный: так
// протухшее согласие или сброшенные данные не оставят включённым мат.
// tones — таблица тонов (клиентская здесь, серверная с текстами в aiPrompt.js).
export function resolveToneIn(tones, prefs) {
  const own = Object.prototype.hasOwnProperty.call(tones, prefs?.[TONE_PREF]) ? tones[prefs[TONE_PREF]] : tones[DEFAULT_TONE]
  if (own.optIn && !hasToneConsent(prefs)) return tones[DEFAULT_TONE]
  return own
}
export const resolveTone = (prefs) => resolveToneIn(TONES, prefs)
