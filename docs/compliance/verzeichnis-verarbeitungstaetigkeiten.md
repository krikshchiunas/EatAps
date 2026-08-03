# Verzeichnis von Verarbeitungstätigkeiten (VVT) — Art. 30 DSGVO

> ⚠️ Шаблон. Заполните [плейсхолдеры] и держите документ у себя (не публикуется).
> Требуется при обработке особых категорий данных (health) — у нас это есть.

## Verantwortlicher
- Name: [Vor- und Nachname / Firma]
- Anschrift: [Adresse]
- Kontakt: [E-Mail]
- Ggf. Datenschutzbeauftragter: [Name/E-Mail oder „nicht bestellt, da nicht erforderlich"]

## Verarbeitungstätigkeit 1 — Kontoführung & Cloud-Synchronisation
- **Zweck:** Speicherung/Synchronisation des Ernährungstagebuchs, Konto.
- **Betroffene:** registrierte Nutzer.
- **Datenkategorien:** Profil (Name, Foto, Geschlecht, Alter, Größe, Gewicht), **Gesundheits-/Ernährungsdaten (Art. 9)**, E-Mail bzw. Wallet-Adresse.
- **Rechtsgrundlage:** Einwilligung, Art. 6(1)(a) + Art. 9(2)(a).
- **Empfänger/Auftragsverarbeiter:** Supabase Inc. (DB/Auth), Vercel Inc. (Hosting).
- **Drittlandtransfer:** [USA — SCC / EU-Region, falls gewählt].
- **Löschfrist:** bis Kontolöschung durch Nutzer (Self-Service in der App).
- **TOM:** siehe `tom.md`.

## Verarbeitungstätigkeit 2 — Anmeldung (Auth)
- **Zweck:** Authentifizierung.
- **Datenkategorien:** E-Mail / OAuth-ID (Google) / Wallet-Adresse.
- **Rechtsgrundlage:** Art. 6(1)(b) (Vertrag/Nutzung) + Einwilligung.
- **Empfänger:** Supabase, ggf. Google (OAuth), ggf. Reown/WalletConnect (Web3).
- **Drittlandtransfer:** USA — SCC.

## Verarbeitungstätigkeit 3 — Freundesfunktion
- **Zweck:** Verknüpfung von Nutzern, Einsicht in geteilte Tagesdaten.
- **Datenkategorien:** öffentliche ID, Anzeigename/Foto, geteilte Ernährungsdaten.
- **Rechtsgrundlage:** Einwilligung (beidseitige Bestätigung).
- **Sichtbarkeit:** nur für bestätigte Freunde (durchgesetzt per RLS).

## Verarbeitungstätigkeit 4 — Hosting/Auslieferung
- **Zweck:** Betrieb der Web-App/PWA.
- **Datenkategorien:** Server-Logs/IP (durch Vercel), technisch notwendig.
- **Rechtsgrundlage:** Art. 6(1)(f).
- **Empfänger:** Vercel Inc.
