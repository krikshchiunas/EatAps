# Datenpannen-Reaktionsplan — Art. 33 / 34 DSGVO

> Что делать при подозрении на утечку данных. Держать под рукой.

## 1. Sofort (bei Entdeckung)
- Vorfall dokumentieren: Zeitpunkt, betroffene Systeme, Datenkategorien, mutmaßliche Ursache.
- Weitere Kompromittierung stoppen (z. B. Keys rotieren in Supabase/Vercel, Sessions invalidieren).

## 2. Bewertung (Risiko)
- Sind personenbezogene Daten betroffen? Besonders **Gesundheitsdaten (Art. 9)** → hohes Risiko.
- Anzahl Betroffener, mögliche Folgen abschätzen.

## 3. Meldung an die Aufsichtsbehörde — **innerhalb 72 Stunden** (Art. 33)
- Zuständige Behörde: [zuständige Landesdatenschutzbehörde nach Ihrem Wohnsitz/Firmensitz].
- Inhalt: Art der Verletzung, Kategorien/Anzahl, wahrscheinliche Folgen, ergriffene Maßnahmen, Kontakt.
- Ausnahme: nur wenn Verletzung **voraussichtlich kein Risiko** darstellt.

## 4. Benachrichtigung der Betroffenen (Art. 34)
- Bei **hohem Risiko** (bei Gesundheitsdaten meist ja): Nutzer unverzüglich in klarer Sprache informieren (per E-Mail / In-App).

## 5. Nachbereitung
- Ursache beheben, TOM anpassen (`tom.md`), Vorfall im internen Register ablegen.

## Kontakte (ausfüllen)
- Verantwortlicher: [Name, E-Mail, Telefon]
- Supabase Support / Security: security@supabase.io
- Vercel Support: über Dashboard
- Aufsichtsbehörde: [Name, Meldeformular-URL]
