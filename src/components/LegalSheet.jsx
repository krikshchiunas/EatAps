import { useState } from 'react'

// ВАЖНО: это ШАБЛОНЫ. Замените все [плейсхолдеры] своими реальными данными
// и покажите юристу перед публикацией. Это не юридическая консультация.

const P = { color: 'var(--ink-2)', fontSize: 14, lineHeight: 1.6, margin: '0 0 12px' }
const H = { fontSize: 15, fontWeight: 650, margin: '18px 0 8px' }

function Impressum() {
  return (
    <div>
      <p style={{ ...P, color: 'var(--danger)' }}>
        ⚠️ Шаблон. Заполните поля [в скобках] и проверьте у юриста перед публикацией.
      </p>
      <h3 style={H}>Angaben gemäß § 5 DDG</h3>
      <p style={P}>
        [Vor- und Nachname / Firmenname]<br />
        [Straße und Hausnummer]<br />
        [PLZ Ort]<br />
        [Land]
      </p>
      <h3 style={H}>Kontakt</h3>
      <p style={P}>
        E-Mail: [ihre@email.de]<br />
        Telefon: [optional]
      </p>
      <h3 style={H}>Verantwortlich i.S.d. § 18 Abs. 2 MStV</h3>
      <p style={P}>[Vor- und Nachname], [Anschrift wie oben]</p>
      <p style={{ ...P, color: 'var(--ink-3)', fontSize: 13 }}>
        Für Kleinunternehmer / Privatpersonen ggf. abweichend — im Zweifel rechtlich prüfen lassen.
      </p>
    </div>
  )
}

function Datenschutz() {
  return (
    <div>
      <p style={{ ...P, color: 'var(--danger)' }}>
        ⚠️ Шаблон. Проверьте у юриста и дополните своими данными.
      </p>

      <h3 style={H}>1. Verantwortlicher</h3>
      <p style={P}>[Name], [Anschrift], [E-Mail]. Siehe auch Impressum.</p>

      <h3 style={H}>2. Welche Daten wir verarbeiten</h3>
      <p style={P}>
        • Profildaten: Name/Nickname, Foto (optional), Geschlecht, Alter, Größe, Gewicht.<br />
        • <b>Gesundheits- und Ernährungsdaten</b> (Mahlzeiten, Kalorien, Wohlbefinden) — besondere
        Kategorien personenbezogener Daten i.S.d. Art. 9 DSGVO.<br />
        • Kontodaten bei Anmeldung: E-Mail-Adresse bzw. Wallet-Adresse.<br />
        • Freundschaften (Ihre Verknüpfungen mit anderen Nutzern).
      </p>

      <h3 style={H}>3. Zwecke und Rechtsgrundlagen</h3>
      <p style={P}>
        Die App funktioniert primär lokal auf Ihrem Gerät (technisch erforderliche Speicherung,
        Art. 6 Abs. 1 lit. f DSGVO). Cloud-Synchronisation, Konto und die Freundesfunktion erfolgen
        nur nach Ihrer <b>ausdrücklichen Einwilligung</b> (Art. 6 Abs. 1 lit. a und Art. 9 Abs. 2
        lit. a DSGVO). Die Einwilligung ist jederzeit mit Wirkung für die Zukunft widerrufbar.
      </p>

      <h3 style={H}>4. Empfänger / Auftragsverarbeiter</h3>
      <p style={P}>
        • Vercel Inc. (Hosting) — USA.<br />
        • Supabase Inc. (Datenbank, Authentifizierung) — Region [ihre Region].<br />
        • Google (nur bei „Anmeldung mit Google“) — USA.<br />
        • Reown / WalletConnect (nur bei Web3-Wallet-Login) — Drittland.<br />
        Bei Übermittlung in Drittländer (z. B. USA) stützen wir uns auf Standardvertragsklauseln
        bzw. einen Angemessenheitsbeschluss. Mit den Auftragsverarbeitern bestehen Verträge nach
        Art. 28 DSGVO.
      </p>

      <h3 style={H}>5. Speicherdauer</h3>
      <p style={P}>
        Daten werden gespeichert, solange Ihr Konto besteht. Sie können Ihre Daten jederzeit in der
        App exportieren und Ihr Konto samt Daten löschen (Profil → Приватность и данные).
      </p>

      <h3 style={H}>6. Ihre Rechte</h3>
      <p style={P}>
        Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18),
        Datenübertragbarkeit (Art. 20), Widerspruch (Art. 21) sowie Widerruf der Einwilligung.
        Zudem haben Sie ein Beschwerderecht bei einer Aufsichtsbehörde
        (z. B. [zuständige Landesdatenschutzbehörde]).
      </p>

      <h3 style={H}>7. Lokale Speicherung</h3>
      <p style={P}>
        Wir nutzen den lokalen Speicher (localStorage) Ihres Browsers für die App-Funktion. Es
        werden <b>keine Tracking-Cookies</b> und keine Werbe-Analyse eingesetzt.
      </p>

      <h3 style={H}>8. Minderjährige</h3>
      <p style={P}>
        Ein Konto mit Cloud-Speicherung ist erst ab <b>16 Jahren</b> zulässig. Nutzer unter 16
        Jahren dürfen die Cloud-Funktionen nur mit Einwilligung der Sorgeberechtigten nutzen
        (Art. 8 DSGVO). Der lokale Gast-Modus bleibt hiervon unberührt.
      </p>

      <h3 style={H}>9. Kontakt für Datenschutzanfragen</h3>
      <p style={P}>
        Anfragen zu Ihren Rechten richten Sie bitte an [datenschutz@ihre-domain.de]. Wir antworten
        innerhalb eines Monats (Art. 12 Abs. 3 DSGVO).
      </p>

      <p style={{ ...P, color: 'var(--ink-3)', fontSize: 13, marginTop: 16 }}>Stand: [Datum]. Version v1.</p>
    </div>
  )
}

function AGB() {
  return (
    <div>
      <p style={{ ...P, color: 'var(--danger)' }}>
        ⚠️ Шаблон условий использования. Проверьте у юриста и дополните.
      </p>
      <h3 style={H}>1. Geltungsbereich</h3>
      <p style={P}>Diese Nutzungsbedingungen gelten für die Nutzung der App/Website EatAps, bereitgestellt von [Name] (siehe Impressum).</p>
      <h3 style={H}>2. Leistung</h3>
      <p style={P}>EatAps ist ein digitales Ernährungstagebuch (Kalorien-/Nährstoff-Tracking, Verlauf, Freundesfunktion). Es ist <b>kein Medizinprodukt</b> und ersetzt keine ärztliche oder ernährungsmedizinische Beratung.</p>
      <h3 style={H}>3. Konto & Registrierung</h3>
      <p style={P}>Für Cloud-Funktionen ist ein Konto nötig. Sie sind für die Geheimhaltung Ihrer Zugangsdaten verantwortlich. Nutzung ab 16 Jahren (siehe Datenschutz).</p>
      <h3 style={H}>4. Pflichten der Nutzer</h3>
      <p style={P}>Keine rechtswidrigen Inhalte, kein Missbrauch der Freundesfunktion, keine Beeinträchtigung des Dienstes. Über Freunde geteilte Daten sind nur für bestätigte Freunde sichtbar.</p>
      <h3 style={H}>5. Haftung</h3>
      <p style={P}>Die Nutzung erfolgt auf eigenes Risiko. Haftung nur für Vorsatz und grobe Fahrlässigkeit sowie nach zwingenden gesetzlichen Vorschriften. Keine Gewähr für die Richtigkeit der Nährwertdaten.</p>
      <h3 style={H}>6. Kündigung</h3>
      <p style={P}>Sie können Ihr Konto jederzeit in der App löschen (Profil → Приватность и данные).</p>
      <h3 style={H}>7. Änderungen & Recht</h3>
      <p style={P}>Wir können diese Bedingungen mit Vorankündigung ändern. Es gilt deutsches Recht. Gerichtsstand [Ort], soweit zulässig.</p>
      <p style={{ ...P, color: 'var(--ink-3)', fontSize: 13, marginTop: 16 }}>Stand: [Datum].</p>
    </div>
  )
}

export default function LegalSheet({ onClose, initial = 'impressum' }) {
  const [tab, setTab] = useState(initial)
  return (
    <div className="sheet-backdrop" onClick={onClose} style={{ zIndex: 60 }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '86vh', overflowY: 'auto' }}>
        <div className="grabber" />
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2 className="h2">Правовая информация</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className="seg" style={{ marginBottom: 16 }}>
          <button className={tab === 'impressum' ? 'on' : ''} onClick={() => setTab('impressum')}>Impressum</button>
          <button className={tab === 'privacy' ? 'on' : ''} onClick={() => setTab('privacy')}>Datenschutz</button>
          <button className={tab === 'agb' ? 'on' : ''} onClick={() => setTab('agb')}>AGB</button>
        </div>
        {tab === 'impressum' ? <Impressum /> : tab === 'agb' ? <AGB /> : <Datenschutz />}
      </div>
    </div>
  )
}
