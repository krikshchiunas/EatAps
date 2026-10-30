// Сборка пакета языка из файлов-групп. Один раздел — один файл: если два файла
// объявят раздел с одним именем, второй молча затёр бы первый, и половина
// подписей экрана вернулась бы к русскому без единой ошибки.
export function merge(...groups) {
  const out = {}
  for (const g of groups) {
    for (const [ns, v] of Object.entries(g)) {
      if (ns in out) throw new Error(`i18n: раздел «${ns}» объявлен дважды`)
      out[ns] = v
    }
  }
  return out
}
