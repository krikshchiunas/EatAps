// Аварийный экран: показывается, если приложение не запустилось (см. index.html).
// Сборка встраивает эти строки прямо в страницу — бандл с переводами в этот
// момент как раз и не загрузился. Никаких {плейсхолдеров}: здесь нет t().
export default {
  title: "EatAps ist nicht gestartet",
  text: "Wahrscheinlich ist noch eine alte Version der App auf dem Gerät. Der Button unten löscht sie und lädt eine neue. ",
  bold: "Deine Ernährungseinträge werden nicht gelöscht",
  tail: " – sie sind separat gespeichert.",
  button: "App aktualisieren",
  hint: "Wenn das nicht hilft, zeig diese Zeile dem Entwickler.",
  homeScreen: "vom Home-Bildschirm",
  failedLoad: "nicht geladen: ",
  startupError: "Fehler beim Start: ",
  timeout: "die App wurde in 12 Sekunden nicht angezeigt",
  noscript: "EatAps benötigt aktiviertes JavaScript.",
}
