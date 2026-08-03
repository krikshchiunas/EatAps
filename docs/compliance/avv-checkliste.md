# AVV / DPA-Checkliste (Art. 28 DSGVO)

> С каждым обработчиком нужен договор об обработке данных (обычно принимается в кабинете).
> Отметьте, когда сделано.

| Auftragsverarbeiter | Zweck | AVV/DPA abgeschlossen | Drittland | Grundlage |
|---|---|---|---|---|
| **Vercel Inc.** | Hosting/CDN | ⬜ | USA | DPA + SCC (im Vercel-Dashboard: Settings → Legal/DPA) |
| **Supabase Inc.** | Datenbank, Auth | ⬜ | [USA/EU] | DPA (Supabase Dashboard → Org → Legal); **Region EU (Frankfurt) wählen** |
| **Google LLC** | OAuth-Login (optional) | ⬜ | USA | Google Cloud DPA |
| **Reown / WalletConnect** | Web3-Login (optional) | ⬜ | Drittland | Terms/DPA des Anbieters |

## Дополнительно
- [ ] Supabase-Projekt-**Region** überprüfen (idealerweise EU/Frankfurt).
- [ ] SCC (Standardvertragsklauseln) für USA-Transfers dokumentieren (liegen den DPAs meist bei).
- [ ] Alle abgeschlossenen DPAs als PDF ablegen.
