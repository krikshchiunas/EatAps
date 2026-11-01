// Аварийный экран: показывается, если приложение не запустилось (см. index.html).
// Сборка встраивает эти строки прямо в страницу — бандл с переводами в этот
// момент как раз и не загрузился. Никаких {плейсхолдеров}: здесь нет t().
export default {
  title: "EatAps no se ha iniciado",
  text: "Lo más probable es que en el dispositivo haya quedado una versión antigua de la app. El botón de abajo la borra y carga una nueva. ",
  bold: "Tus registros de comida no se borrarán",
  tail: ": se guardan aparte.",
  button: "Actualizar la app",
  hint: "Si no funciona, enséñale esta línea al desarrollador.",
  homeScreen: "desde la pantalla de inicio",
  failedLoad: "no se cargó ",
  startupError: "error al iniciar: ",
  timeout: "la app no se mostró en 12 segundos",
  noscript: "EatAps necesita JavaScript activado.",
}
