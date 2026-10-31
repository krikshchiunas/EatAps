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
import { t } from '../lib/i18n.js'

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
    <Panel title={t('settings.row.tone')} onClose={onClose}>
      <Group note={t('ai.tone.note')}>
        {ORDER.map((id) => {
          const tone = TONES[id]
          return (
            <Row
              key={id}
              label={tone.optIn ? `${tone.label} · 18+` : tone.label}
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
        <Group note={t('ai.tone.consentNote')}>
          <Row
            label={t('ai.tone.revoke')}
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
    <Panel title={t('ai.gate.title')} onClose={onClose}>
      <div style={{ padding: '0 2px 8px' }}>
        <p style={{ fontSize: 15, lineHeight: 1.5, margin: '0 0 14px' }}>
          {t('ai.gate.intro')}
        </p>

        <Group title={t('ai.gate.will')}>
          <Bullet>{t('ai.gate.will1')}</Bullet>
          <Bullet>{t('ai.gate.will2')}</Bullet>
          <Bullet>{t('ai.gate.will3')}</Bullet>
        </Group>

        <Group title={t('ai.gate.never')}>
          <Bullet>{t('ai.gate.never1')}</Bullet>
          <Bullet>{t('ai.gate.never2')}</Bullet>
          <Bullet>{t('ai.gate.never3')}</Bullet>
        </Group>

        <p className="set-note" style={{ margin: '0 0 16px' }}>
          {t('ai.gate.safety')}
        </p>

        <Check checked={age} onChange={setAge}>
          {t('ai.gate.age')}
        </Check>
        <Check checked={terms} onChange={setTerms}>
          {t('ai.gate.terms')}
        </Check>

        <button className="btn" disabled={!ready} onClick={onAccept} style={{ marginTop: 18 }}>
          {t('ai.gate.enable')}
        </button>
        <button className="btn ghost" onClick={onClose} style={{ marginTop: 10 }}>
          {t('ai.gate.decline')}
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
