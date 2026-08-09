import { useEffect, useRef, useState, useCallback } from 'react'
import { scanLuma, toLuma, expandUpcE } from '../lib/barcode.js'
import { lookupBarcode } from '../lib/foods.js'

// ─────────────────────────────────────────────────────────────────────────────
// Камера для считывания штрихкода с упаковки.
//
// Кнопки «снять» здесь нет намеренно: кадры разбираются на лету, и как только
// код прочитан — экран сам уходит к количеству. Всё, что делает человек, —
// подносит упаковку к рамке.
//
// Камера не закрывается сама ни при какой неудаче: не читается код, нет товара
// в базе, пропала связь — картинка остаётся, уйти можно только «Отменой».
// ─────────────────────────────────────────────────────────────────────────────

const SCAN_INTERVAL = 90 // мс между разборами кадра — чаще незачем, реже заметно
const CONFIRM_HITS = 2 // сколько раз должен совпасть код, прежде чем ему верить
const HINT_AFTER = 6000 // через сколько показать подсказку, если не читается
const SCAN_WIDTH = 900 // до какой ширины ужимать кадр перед разбором
// Сколько ждать от системного распознавателя, прежде чем включить ещё и свой.
const NATIVE_GRACE = 4000
const NATIVE_ERRORS_MAX = 3 // столько подряд — и системный распознаватель выключаем

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

// В Chrome/Android есть системный распознаватель — он быстрее и берёт коды под
// углом. В Safari его нет, там работает наш разбор (lib/barcode.js).
async function makeNativeDetector() {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats()
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f))
    if (!formats.length) return null
    return new window.BarcodeDetector({ formats })
  } catch {
    return null
  }
}

// Системный распознаватель отдаёт UPC-E восемью цифрами — в базе товар лежит
// под полным UPC-A, поэтому разворачиваем тем же кодом, что и свой декодер.
function normalizeNative(value, format) {
  if (format === 'upc_e' && /^\d{8}$/.test(value)) {
    const six = [...value.slice(1, 7)].map(Number)
    return expandUpcE(+value[0], six, +value[7]) || value
  }
  return value
}

export default function BarcodeScanner({ onClose, onFound, onManual }) {
  // starting → scanning — рабочий путь; остальное это отказы, у каждого свой текст.
  const [phase, setPhase] = useState('starting')
  // Что показываем поверх камеры: поиск товара, «не найден», «нет связи».
  const [result, setResult] = useState(null)
  const [hint, setHint] = useState(false)

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const lastScanRef = useRef(0)
  const busyRef = useRef(false)
  const detectorRef = useRef(null)
  // Сколько раз подряд встретился каждый код: одна строка кадра с верной
  // контрольной суммой ошибается редко, но не никогда.
  const tallyRef = useRef(new Map())
  // Коды, которых точно нет в базе: без этого диалог «не найден» всплывал бы
  // снова через кадр после «Сканировать снова» — камера-то смотрит туда же.
  const rejectedRef = useRef(new Set())
  const pausedRef = useRef(false)
  const aliveRef = useRef(true)
  const nativeErrorsRef = useRef(0)
  const startedRef = useRef(0)

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    const stream = streamRef.current
    streamRef.current = null
    if (stream) for (const track of stream.getTracks()) track.stop()
  }, [])

  const close = useCallback(() => {
    aliveRef.current = false
    stopCamera()
    onClose()
  }, [onClose, stopCamera])

  // Код прочитан и подтверждён — ищем товар. Камеру не гасим: если товара нет,
  // человек тут же наведётся на другой.
  const handleCode = useCallback(async (code) => {
    pausedRef.current = true
    setHint(false)
    setResult({ status: 'looking', code })
    if (navigator.vibrate) { try { navigator.vibrate(30) } catch {} }

    try {
      const found = await lookupBarcode(code)
      if (!aliveRef.current) return
      if (found.status === 'ok') {
        aliveRef.current = false
        stopCamera()
        onFound(found.food)
        return
      }
      if (found.status === 'no-nutrition') {
        // Название нашли — второй раз вводить его руками человек не должен.
        aliveRef.current = false
        stopCamera()
        onManual(found.name, found.drink)
        return
      }
      rejectedRef.current.add(code)
      setResult({ status: 'not-found', code })
    } catch {
      if (!aliveRef.current) return
      setResult({ status: 'offline', code })
    }
  }, [onFound, onManual, stopCamera])

  const scanAgain = useCallback(() => {
    tallyRef.current.clear()
    setResult(null)
    pausedRef.current = false
    lastScanRef.current = 0
    startedRef.current = performance.now()
  }, [])

  // ── Запуск камеры ──────────────────────────────────────────────────────────
  useEffect(() => {
    aliveRef.current = true
    let cancelled = false

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase(window.isSecureContext === false ? 'insecure' : 'unsupported')
        return
      }
      // Задняя камера — «ideal», а не «exact»: на ноутбуке exact просто падает,
      // хотя единственная камера там вполне рабочая.
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      }
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch (e) {
        if (e?.name === 'OverconstrainedError') {
          try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }) } catch (e2) { e = e2 }
        }
        if (!stream) {
          if (cancelled) return
          const name = e?.name
          if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') setPhase('denied')
          else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') setPhase('nocamera')
          else if (name === 'NotReadableError' || name === 'TrackStartError') setPhase('busy')
          else setPhase('failed')
          return
        }
      }
      if (cancelled) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        try { await video.play() } catch {}
      }
      detectorRef.current = await makeNativeDetector()
      if (cancelled) return
      setPhase('scanning')
    }

    start()
    return () => {
      cancelled = true
      aliveRef.current = false
      stopCamera()
    }
  }, [stopCamera])

  // ── Разбор кадров ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'scanning') return
    if (!startedRef.current) startedRef.current = performance.now()

    const bump = (raw, format) => {
      const code = normalizeNative(String(raw), format)
      if (!/^\d{8}$|^\d{12,13}$/.test(code)) return
      if (rejectedRef.current.has(code)) return
      const tally = tallyRef.current
      const hits = (tally.get(code) || 0) + 1
      tally.set(code, hits)
      if (hits >= CONFIRM_HITS) handleCode(code)
    }

    const readFrame = async () => {
      const video = videoRef.current
      if (!video || video.readyState < 2 || !video.videoWidth) return

      if (detectorRef.current) {
        let found = false
        try {
          const codes = await detectorRef.current.detect(video)
          nativeErrorsRef.current = 0
          for (const c of codes) if (c.rawValue) { bump(c.rawValue, c.format); found = true }
        } catch {
          // Системный распознаватель бывает объявлен, но нерабочим. Молча
          // глотать это нельзя: человек будет водить камерой по упаковке, а
          // сканер — никогда ничего не прочитать. Отключаем и переходим на свой.
          if (++nativeErrorsRef.current >= NATIVE_ERRORS_MAX) detectorRef.current = null
        }
        if (found) return
        // Он же может не падать, а просто ничего не находить. Поэтому, если
        // спустя несколько секунд результата нет, к нему добавляется наш разбор.
        if (performance.now() - startedRef.current < NATIVE_GRACE) return
      }

      // Свой разбор: берём широкую полосу по центру кадра — заведомо шире
      // нарисованной рамки, чтобы всё, что человек в неё поместил, точно попало.
      const vw = video.videoWidth
      const vh = video.videoHeight
      const bandH = Math.round(vh * 0.42)
      const bandY = Math.round((vh - bandH) / 2)
      const width = Math.min(vw, SCAN_WIDTH)
      const height = Math.max(1, Math.round((bandH * width) / vw))

      let canvas = canvasRef.current
      if (!canvas) canvas = canvasRef.current = document.createElement('canvas')
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(video, 0, bandY, vw, bandH, 0, 0, width, height)
      const { data } = ctx.getImageData(0, 0, width, height)
      const hit = scanLuma(toLuma(data, width, height), width, height)
      if (!hit) return
      // Несколько строк одного кадра сошлись на одном коде — это уже
      // подтверждение, ждать следующего кадра незачем.
      for (let i = 0; i < hit.hits; i++) bump(hit.code)
    }

    const tick = (now) => {
      rafRef.current = requestAnimationFrame(tick)
      if (pausedRef.current || busyRef.current) return
      if (now - lastScanRef.current < SCAN_INTERVAL) return
      lastScanRef.current = now
      busyRef.current = true
      Promise.resolve()
        .then(readFrame)
        .catch(() => {})
        .finally(() => { busyRef.current = false })
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [phase, handleCode])

  // Ненавязчивая подсказка, если код долго не даётся. Камеру не трогаем.
  useEffect(() => {
    if (phase !== 'scanning' || result) { setHint(false); return }
    const t = setTimeout(() => setHint(true), HINT_AFTER)
    return () => clearTimeout(t)
  }, [phase, result])

  const failure = FAILURES[phase]

  return (
    <div className="scanner" onClick={(e) => e.stopPropagation()}>
      <video ref={videoRef} className="scanner-video" playsInline muted autoPlay />

      <div className="scanner-top">
        <span className="scanner-title">Штрихкод</span>
        <button className="scanner-x" onClick={close} aria-label="Закрыть">✕</button>
      </div>

      {phase === 'scanning' && !result && (
        <>
          <div className="scanner-frame">
            <i className="c tl" /><i className="c tr" /><i className="c bl" /><i className="c br" />
            <div className="scanner-beam" />
          </div>
          <p className="scanner-hint">Наведите камеру на штрихкод продукта</p>
          {hint && (
            <p className="scanner-tip">
              Не читается? Поднесите ближе, чтобы штрихкод занял рамку целиком, и дайте камере навестись.
            </p>
          )}
        </>
      )}

      {phase === 'starting' && <p className="scanner-hint">Включаем камеру…</p>}

      {failure && (
        <div className="scanner-card">
          <h3>{failure.title}</h3>
          <p>{failure.text}</p>
          <button className="btn" onClick={() => onManual('')}>Добавить вручную</button>
        </div>
      )}

      {result?.status === 'looking' && (
        <div className="scanner-card">
          <h3>Ищем продукт…</h3>
          <p className="scanner-code">{result.code}</p>
        </div>
      )}

      {result?.status === 'not-found' && (
        <div className="scanner-card">
          <h3>Продукт не найден</h3>
          <p>Штрихкод считан, но такого товара нет в базе.</p>
          <p className="scanner-code">{result.code}</p>
          <button className="btn" onClick={() => onManual('')}>Добавить вручную</button>
          <button className="btn ghost" onClick={scanAgain}>Сканировать снова</button>
        </div>
      )}

      {result?.status === 'offline' && (
        <div className="scanner-card">
          <h3>Нет связи с базой</h3>
          <p>Не удалось проверить штрихкод. Проверьте интернет и попробуйте ещё раз.</p>
          <p className="scanner-code">{result.code}</p>
          <button className="btn" onClick={() => handleCode(result.code)}>Повторить</button>
          <button className="btn ghost" onClick={() => onManual('')}>Добавить вручную</button>
        </div>
      )}

      <div className="scanner-bottom">
        <button className="btn ghost scanner-cancel" onClick={close}>Отмена</button>
      </div>
    </div>
  )
}

// Отказы камеры. Текст должен говорить, что делать дальше, а не как называется
// исключение в браузере.
const FAILURES = {
  denied: {
    title: 'Нет доступа к камере',
    text: 'Разрешите камеру для EatAps в настройках браузера — на iPhone это «Настройки → Safari → Камера» — и откройте сканер заново.',
  },
  nocamera: {
    title: 'Камера не найдена',
    text: 'На этом устройстве нет доступной камеры.',
  },
  busy: {
    title: 'Камера занята',
    text: 'Её использует другое приложение или вкладка. Закройте их и попробуйте снова.',
  },
  insecure: {
    title: 'Камера недоступна',
    text: 'Браузер разрешает камеру только на защищённом соединении (https).',
  },
  unsupported: {
    title: 'Браузер не умеет включать камеру',
    text: 'Откройте EatAps в Safari или Chrome — или добавьте продукт вручную.',
  },
  failed: {
    title: 'Не удалось включить камеру',
    text: 'Попробуйте закрыть и открыть сканер заново.',
  },
}
