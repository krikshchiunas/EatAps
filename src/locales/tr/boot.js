// Аварийный экран: показывается, если приложение не запустилось (см. index.html).
// Сборка встраивает эти строки прямо в страницу — бандл с переводами в этот
// момент как раз и не загрузился. Никаких {плейсхолдеров}: здесь нет t().
export default {
  title: "EatAps açılmadı",
  text: "Büyük olasılıkla cihazda uygulamanın eski bir sürümü kaldı. Aşağıdaki düğme onu temizleyip yenisini yükler. ",
  bold: "Beslenme kayıtların silinmez",
  tail: " — onlar ayrı saklanıyor.",
  button: "Uygulamayı güncelle",
  hint: "İşe yaramazsa bu satırı geliştiriciye göster.",
  homeScreen: "ana ekrandan",
  failedLoad: "yüklenemedi: ",
  startupError: "başlatma hatası: ",
  timeout: "uygulama 12 saniye içinde görüntülenmedi",
  noscript: "EatAps için JavaScript’in açık olması gerekir.",
}
