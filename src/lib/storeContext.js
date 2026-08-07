import { createContext, useContext } from 'react'

// Контекст вынесен из store.jsx в отдельный модуль намеренно.
//
// Vite Fast Refresh при правке файла заново выполняет его модуль. Пока
// createContext() жил в store.jsx, каждая правка стора создавала НОВЫЙ объект
// контекста, а уже смонтированные компоненты продолжали читать старый — и
// падали с «useStore must be used within StoreProvider» до полной перезагрузки
// страницы. Этот модуль меняется редко, поэтому идентичность контекста
// переживает правки провайдера.
export const StoreCtx = createContext(null)

export function useStore() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
