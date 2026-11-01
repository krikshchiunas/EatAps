import { useEffect, useSyncExternalStore } from 'react'
import { loadSearchNames, onSearchNamesLoaded, searchNamesReady } from './search/index.js'

// Догружены ли названия всех языков для поиска. Компонент с поиском
// перерисуется, когда они придут: выдача по «Haferflocken» появится сама, без
// повторного ввода. Загрузку заодно и запускает (если она ещё не шла).
export function useSearchNames() {
  useEffect(() => { loadSearchNames() }, [])
  return useSyncExternalStore(onSearchNamesLoaded, searchNamesReady, searchNamesReady)
}
