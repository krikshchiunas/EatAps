// ─────────────────────────────────────────────────────────────────────────────
// Тон AI-ассистента.
//
// Четыре пресета: от спокойного нутрициолога до режима без цензуры. Первые три
// включаются одним касанием — это вопрос вкуса. Последний требует явного
// согласия, и вот почему так, а не просто «вы уверены?»:
//
//   • человек должен УВИДЕТЬ, что именно включает, до первого сообщения, а не
//     узнать это от ассистента, который уже начал материться;
//   • галочка — не формальность, а точка, где решение принято осознанно:
//     кнопка мертва, пока её не поставили;
//   • согласие версионировано. Поменяется суть предупреждения — поднимем
//     версию, и режим сам выключится до нового подтверждения.
//
// Выключить можно в одно касание, выбрав любой другой тон. Никаких «вы точно
// хотите уйти» — удерживать человека в режиме, где на него орут, было бы
// свинством.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { useStore } from '../store.jsx'
import { Panel, Group, Row } from './SettingsPanels.jsx'
import { TONES, DEFAULT_TONE, TONE_PREF, TONE_CONSENT_PREF, TONE_CONSENT_VERSION, hasToneConsent } from '../lib/aiPrompt.js'

// Порядок показа: от нейтрального к жёсткому. savage последним — он за опт-ином.
const ORDER = ['calm', 'buddy', 'doctor', 'coach', 'strict', 'savage']

export default function AITonePanel({ onClose }) {
  const { prefs, setPref } = useStore()
  const current = prefs?.[TONE_PREF] || DEFAULT_TONE
  const [consentFor, setConsentFor] = useState(null) // id тона, для которого открыт гейт

  const pick = (id) => {
    const tone = TONES[id]
    if (tone.optIn && !hasToneConsent(prefs)) { setConsentFor(id); return }
    setPref(TONE_PREF, id)
  }

  const accept = (id) => {
    setPref(TONE_CONSENT_PREF, { version: TONE_CONSENT_VERSION, at: new Date().toISOString() })
    setPref(TONE_PREF, id)
    setConsentFor(null)
  }

  if (consentFor) {
    return <ConsentGate toneId={consentFor} onAccept={() => accept(consentFor)} onClose={() => setConsentFor(null)} />
  }

  return (
    <Panel title="Тон ассистента" onClose={onClose}>
      <Group note="Тон меняет только манеру речи. Расчёты, цифры и рекомендации во всех режимах одинаковые.">
        {ORDER.map((id) => {
          const t = TONES[id]
          return (
            <Row
              key={id}
              label={t.optIn ? `${t.label} · 18+` : t.label}
              value={current === id ? '✓' : null}
              onClick={() => pick(id)}
              chevron={false}
            />
          )
        })}
      </Group>

      <Group>
        <p className="set-note" style={{ margin: 0, padding: '10px 14px' }}>
          {TONES[current]?.hint}
        </p>
      </Group>

      {hasToneConsent(prefs) && (
        <Group note="Согласие на режим без цензуры останется, пока вы его не отзовёте. После отзыва режим выключится.">
          <Row
            label="Отозвать согласие 18+"
            danger
            chevron={false}
            onClick={() => {
              setPref(TONE_CONSENT_PREF, null)
              if (TONES[current]?.optIn) setPref(TONE_PREF, DEFAULT_TONE)
            }}
          />
        </Group>
      )}
    </Panel>
  )
}

// ── Гейт согласия ────────────────────────────────────────────────────────────
function ConsentGate({ toneId, onAccept, onClose }) {
  const [age, setAge] = useState(false)
  const [terms, setTerms] = useState(false)
  const ready = age && terms

  return (
    <Panel title="Без цензуры · 18+" onClose={onClose}>
      <div style={{ padding: '0 2px 8px' }}>
        <p style={{ fontSize: 15, lineHeight: 1.5, margin: '0 0 14px' }}>
          В этом режиме ассистент говорит матом и разносит вас за каждый промах в питании.
          Без утешений, без «ничего страшного», без мягких формулировок.
        </p>

        <Group title="Что он будет делать">
          <Bullet>Материться и называть вещи своими именами — про еду, порции и решения.</Bullet>
          <Bullet>Тыкать в цифры дневника: перебор, недобор белка, четвёртая пачка за неделю.</Bullet>
          <Bullet>Не принимать оправданий и требовать конкретных действий на сегодня.</Bullet>
        </Group>

        <Group title="Чего он не будет делать никогда">
          <Bullet>Обсуждать ваш вес, тело, внешность и цифры на весах как повод для унижения.</Bullet>
          <Bullet>Оскорблять вас как человека — вашу личность, ум, будущее, близких.</Bullet>
          <Bullet>Советовать голодать, пропускать еду или «отрабатывать» съеденное тренировкой.</Bullet>
        </Group>

        <p className="set-note" style={{ margin: '0 0 16px' }}>
          Если в разговоре появятся признаки срыва, тревоги или расстройства пищевого поведения,
          ассистент сам перейдёт на спокойный тон. Выключить режим можно в любой момент — выбрать другой тон в этом же списке.
          Это не медицинская помощь и не замена врача.
        </p>

        <Check checked={age} onChange={setAge}>
          Мне есть 18 лет.
        </Check>
        <Check checked={terms} onChange={setTerms}>
          Я прочитал(а) предупреждение, включаю режим добровольно и понимаю, что ассистент будет
          использовать нецензурную лексику и жёстко критиковать мои решения о еде.
        </Check>

        <button className="btn" disabled={!ready} onClick={onAccept} style={{ marginTop: 18 }}>
          Включить режим
        </button>
        <button className="btn ghost" onClick={onClose} style={{ marginTop: 10 }}>
          Не включать
        </button>
      </div>
    </Panel>
  )
}

function Bullet({ children }) {
  return (
    <div className="set-row" style={{ alignItems: 'flex-start', gap: 10 }}>
      <span aria-hidden style={{ color: 'var(--ink-3)', flex: '0 0 auto' }}>•</span>
      <span style={{ fontSize: 14, lineHeight: 1.45, minWidth: 0 }}>{children}</span>
    </div>
  )
}

function Check({ checked, onChange, children }) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%', textAlign: 'left',
        background: 'none', border: 'none', padding: '10px 2px', color: 'inherit', cursor: 'pointer',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 22, height: 22, borderRadius: 6, flex: '0 0 auto', marginTop: 1,
          border: `1.8px solid ${checked ? 'var(--primary)' : 'var(--ink-3)'}`,
          background: checked ? 'var(--primary)' : 'transparent',
          color: 'var(--on-primary)', display: 'grid', placeItems: 'center', fontSize: 14, lineHeight: 1,
        }}
      >
        {checked ? '✓' : ''}
      </span>
      <span style={{ fontSize: 13.5, lineHeight: 1.45 }}>{children}</span>
    </button>
  )
}
