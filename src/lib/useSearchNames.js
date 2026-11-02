import { useEffect, useSyncExternalStore } from 'react'
import { loadSearch, onSearchReady, searchReady } from './search/lazy.js'

// Загружен ли поисковый движок с названиями всех языков. Компонент с поиском
// перерисуется, когда он придёт: выдача по «Haferflocken» появится сама, без
// повторного ввода. Загрузку заодно и запускает (если она ещё не шла).
export function useSearchNames() {
  useEffect(() => { loadSearch() }, [])
  return useSyncExternalStore(onSearchReady, searchReady, searchReady)
}
