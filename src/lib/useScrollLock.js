import { useLayoutEffect, useSyncExternalStore } from 'react'

// Полная заморозка фонового экрана, пока открыт оверлей/лист. Никаких скроллов,
// свайпов и тапов по фону — все жесты достаются только верхнему активному слою.
//
// Техника iOS: body → position:fixed со сдвигом на текущий scrollY. Это надёжно
// глушит и колёсико, и тач-скролл, и inertial-bounce (в отличие от overflow:hidden
// на мобильном Safari). Счётчик поддерживает вложенные оверлеи.
let lockCount = 0
let savedY = 0

// Счётчик блокировок — заодно единственный честный ответ на вопрос «открыт ли
// сейчас поверх экрана хоть какой-нибудь лист».
//
// Раньше это перечислялось руками: paused={sectionSheet || editingFood || …}.
// Такой список неизбежно отстаёт — каждый новый лист нужно не забыть в него
// вписать, и подсказка снова вылезала поверх открытого листа. Здесь же
// регистрируется КАЖДЫЙ лист (useSheetDrag вызывает useScrollLock), поэтому
// новые экраны учитываются сами, без правки этого места.
const listeners = new Set()

function setCount(n) {
  lockCount = n
  for (const fn of listeners) fn()
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// true, пока открыт хотя бы один лист или полноэкранный оверлей.
export function useOverlayOpen() {
  return useSyncExternalStore(subscribe, () => lockCount > 0, () => false)
}

export function useScrollLock() {
  useLayoutEffect(() => {
    setCount(lockCount + 1)
    if (lockCount === 1) {
      savedY = window.scrollY || window.pageYOffset || 0
      const b = document.body
      b.style.position = 'fixed'
      b.style.top = `-${savedY}px`
      b.style.left = '0'
      b.style.right = '0'
      b.style.width = '100%'
      b.style.overflow = 'hidden'
      // Подстраховка от bounce на самом документе.
      document.documentElement.style.overscrollBehavior = 'none'
    }
    return () => {
      setCount(lockCount - 1)
      if (lockCount === 0) {
        const b = document.body
        b.style.position = ''
        b.style.top = ''
        b.style.left = ''
        b.style.right = ''
        b.style.width = ''
        b.style.overflow = ''
        document.documentElement.style.overscrollBehavior = ''
        window.scrollTo(0, savedY)
      }
    }
  }, [])
}
