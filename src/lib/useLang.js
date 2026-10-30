import { useSyncExternalStore } from 'react'
import { getLang, onLangChange } from './i18n.js'

// Текущий язык с подпиской на его смену. Достаточно, чтобы его читал App:
// он перерисовывает всё дерево. Отдельно нужен только тем, кто обёрнут в memo
// и при смене языка иначе остался бы со старыми подписями.
export function useLang() {
  return useSyncExternalStore(onLangChange, getLang, getLang)
}
