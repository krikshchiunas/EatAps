// Аварийный экран: показывается, если приложение не запустилось (см. index.html).
// Сборка встраивает эти строки прямо в страницу — бандл с переводами в этот
// момент как раз и не загрузился. Никаких {плейсхолдеров}: здесь нет t().
export default {
  title: "O EatAps não iniciou",
  text: "Provavelmente ficou uma versão antiga do app no aparelho. O botão abaixo a remove e carrega uma nova. ",
  bold: "Seus registros alimentares não serão apagados",
  tail: " — eles ficam salvos à parte.",
  button: "Atualizar o app",
  hint: "Se não ajudar, mostre esta linha ao desenvolvedor.",
  homeScreen: "da tela de início",
  failedLoad: "não carregou ",
  startupError: "falha ao iniciar: ",
  timeout: "o app não apareceu em 12 segundos",
  noscript: "O EatAps precisa do JavaScript ativado.",
}
