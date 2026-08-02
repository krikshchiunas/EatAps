import { useState, useRef, useEffect } from 'react'

// Анимированная заставка при ПЕРВОМ запуске. Проигрывается один раз
// (флаг в localStorage), плавно исчезает по окончании ролика, по ошибке,
// по таймауту-предохранителю или по тапу.
export default function IntroSplash({ onDone }) {
  const [closing, setClosing] = useState(false)
  const videoRef = useRef(null)
  const doneRef = useRef(false)

  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    setClosing(true)
    setTimeout(onDone, 450) // дать доиграть fade-out
  }

  useEffect(() => {
    const v = videoRef.current
    const safety = setTimeout(finish, 8000) // не зависать, если ролик не доиграл
    // muted + playsInline → автоплей разрешён; если всё равно отклонён — пропускаем
    v?.play?.().catch(() => finish())
    return () => clearTimeout(safety)
  }, [])

  return (
    <div
      onClick={finish}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#1E2420',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: closing ? 0 : 1,
        transition: 'opacity .45s ease',
        pointerEvents: closing ? 'none' : 'auto',
      }}
    >
      <video
        ref={videoRef}
        src="/intro.mp4"
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={finish}
        onError={finish}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </div>
  )
}
