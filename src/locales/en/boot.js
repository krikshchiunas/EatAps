// Аварийный экран: показывается, если приложение не запустилось (см. index.html).
// Сборка встраивает эти строки прямо в страницу — бандл с переводами в этот
// момент как раз и не загрузился. Никаких {плейсхолдеров}: здесь нет t().
export default {
  title: "EatAps didn’t start",
  text: "Most likely an old version of the app is still on your device. The button below clears it and loads a fresh one. ",
  bold: "Your food entries won’t be deleted",
  tail: " — they’re stored separately.",
  button: "Update the app",
  hint: "If that didn’t help, show this line to the developer.",
  homeScreen: "from the Home Screen",
  failedLoad: "failed to load ",
  startupError: "startup error: ",
  timeout: "the app didn’t render within 12 seconds",
  noscript: "EatAps needs JavaScript to be enabled.",
}
