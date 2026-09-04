// Тост с необязательным действием «Отменить».
//
// Вынесен из AddMealSheet, потому что понадобился в двух местах сразу и с
// разным временем жизни. Быстрое добавление показывает его поверх открытого
// листа, а обычное — уже после того, как лист закрылся: тост, живущий внутри
// листа, исчезал вместе с ним, и у главного пути добавления отмены не было
// вовсе. Одна разметка на оба случая, чтобы они не разъехались.
import { useEffect, useRef } from 'react'

export default function Toast({ toast, onDone }) {
  const timer = useRef(null)
  useEffect(() => {
    clearTimeout(timer.current)
    if (!toast) return undefined
    // С действием тост живёт дольше: до кнопки надо успеть дотянуться.
    timer.current = setTimeout(onDone, toast.undo ? 4000 : 1600)
    return () => clearTimeout(timer.current)
  }, [toast, onDone])

  if (!toast) return null
  return (
    <div
      role="status"
      aria-live="polite"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', top: 'calc(env(safe-area-inset-top) + 16px)', left: '50%',
        transform: 'translateX(-50%)', zIndex: 1000,
        maxWidth: 'min(92vw, 420px)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--primary)', color: 'var(--on-primary)',
        padding: toast.undo ? '9px 10px 9px 18px' : '10px 18px', borderRadius: 999,
        fontSize: 14, fontWeight: 600, letterSpacing: -0.1,
        boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
        animation: 'toast-in 0.22s cubic-bezier(0.22,1,0.36,1) both',
        // Обычный тост не должен перехватывать касания списка под ним;
        // тосту с кнопкой они, наоборот, необходимы.
        pointerEvents: toast.undo ? 'auto' : 'none',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toast.msg}</span>
      {toast.undo && (
        <button
          onClick={() => { const u = toast.undo; onDone(); u() }}
          style={{
            flex: '0 0 auto', minHeight: 34, padding: '7px 14px', borderRadius: 999,
            background: 'var(--on-primary)', color: 'var(--primary)', fontWeight: 700, fontSize: 13.5,
          }}
        >Отменить</button>
      )}
    </div>
  )
}
