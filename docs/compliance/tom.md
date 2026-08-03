# Technische und organisatorische Maßnahmen (TOM) — Art. 32 DSGVO

> Внутренний документ. Отражает уже реализованное в EatAps + что подтвердить.

## Vertraulichkeit
- **Transportverschlüsselung:** HTTPS erzwungen, HSTS (`max-age` 2 Jahre, preload). ✅
- **Zugriffskontrolle (DB):** Supabase **Row Level Security** — jeder Nutzer sieht nur eigene Daten; Freundesdaten nur bei bestätigter Freundschaft. ✅
- **Auth:** Passwörter/OAuth über Supabase (gehasht, nicht im Klartext). ✅
- **Keine Service-Role-Keys im Client** (nur `anon`-Key). ✅
- **Empfohlen:** Supabase „Leaked password protection" + Rate-Limits aktivieren. ⬜

## Integrität
- **Security-Header:** CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`. ✅
- **Eingabevalidierung** client- und DB-seitig (Constraints/RLS). ✅

## Verfügbarkeit
- **Hosting:** Vercel (CDN, TLS, DDoS-Basisschutz). ✅
- **Backups:** Supabase-Backups gemäß Plan — [Backup-Frequenz prüfen/aktivieren]. ⬜
- **Offline-Fähigkeit:** lokale Speicherung + Service Worker. ✅

## Belastbarkeit & Wiederherstellung
- **Datenexport** durch Nutzer (JSON). ✅
- **Wiederherstellung:** [Supabase Point-in-Time-Recovery prüfen]. ⬜

## Betroffenenrechte (technisch umgesetzt)
- **Auskunft/Portabilität:** Export als JSON in der App. ✅
- **Löschung:** Self-Service „Konto löschen" (`delete_current_user`, kaskadiert). ✅

## Organisatorisch
- Zugriff auf Supabase/Vercel-Konsolen nur durch [Berechtigte].
- 2FA für Supabase-, Vercel-, GitHub-, Google-Konten aktivieren. ⬜
- Datenpannen-Prozess: siehe `datenpannen-plan.md`.
