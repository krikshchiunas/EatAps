import { lazy } from 'react'

const FLAG = 'eataps:chunkReload'

// React.lazy с самолечением: если динамический импорт чанка упал (частый случай —
// после нового деплоя в кэше старый index со ссылкой на исчезнувший чанк),
// один раз перезагружаем страницу, чтобы подтянуть свежие файлы. Флаг в
// sessionStorage не даёт зациклиться; при успешной загрузке флаг снимаем.
export function lazyWithReload(factory) {
  return lazy(() =>
    factory()
      .then((mod) => {
        try {
          sessionStorage.removeItem(FLAG)
        } catch {}
        return mod
      })
      .catch((err) => {
        let reloaded = false
        try {
          reloaded = !!sessionStorage.getItem(FLAG)
          if (!reloaded) sessionStorage.setItem(FLAG, '1')
        } catch {}
        if (!reloaded) {
          window.location.reload()
          return new Promise(() => {}) // подвисаем до перезагрузки, не рендерим
        }
        throw err
      })
  )
}
