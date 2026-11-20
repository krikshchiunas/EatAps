// «Штрихкод: помощь ИИ» для экранов: включена ли функция у этого человека и
// функция проверки товара по коду. Решение «включена» — настройка И тариф И
// вход в аккаунт (см. barcodeAIOn); сервер проверяет тариф ещё раз сам.
import { useCallback } from 'react'
import { useStore } from './storeContext.js'
import { barcodeAIOn } from './barcodeAI.js'
import { verifyBarcode } from './aiClient.js'

export function useBarcodeAI() {
  const { prefs, subscription, signedIn, session } = useStore()
  const enabled = barcodeAIOn({ prefs, subscription, signedIn })
  const check = useCallback((code) => verifyBarcode({ code, session }), [session])
  return { enabled, check }
}
