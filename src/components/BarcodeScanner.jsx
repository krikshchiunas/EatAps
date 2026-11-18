import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { scanLuma, toLuma, expandUpcE } from '../lib/barcode.js'
import { lookupBarcode } from '../lib/foods.js'
import { t } from '../lib/i18n.js'

// ─────────────────────────────────────────────────────────────────────────────
// Камера для считывания штрихкода с упаковки.
//
// Кнопки «снять» здесь нет намеренно: кадры разбираются на лету, и как только
// код прочитан — экран сам уходит к количеству. Всё, что делает человек, —
// подносит упаковку к рамке.
//
// Камера не закрывается сама ни при какой неудаче: не читается код, нет товара
// в базе, пропала связь — картинка остаётся, уйти можно только «Отменой».
//
// Порядок поиска товара по коду:
//   1. «Мои продукты» (findOwn) — мгновенно и без сети. Однажды заведённый
//      товар узнаётся сразу и с цифрами самого человека, а не базы;
//   2. Open Food Facts;
//   3. нет в базе или нет состава — onMissing: завести свой продукт с этим
//      штрихкодом, чтобы в следующий раз он узнался на шаге 1.
// ─────────────────────────────────────────────────────────────────────────────

const SCAN_INTERVAL = 90 // мс между разборами кадра — чаще незачем, реже заметно
const CONFIRM_HITS = 2 // сколько раз должен совпасть код, прежде чем ему верить
const HINT_AFTER = 6000 // через сколько показать подсказку, если не читается
const SCAN_WIDTH = 900 // до какой ширины ужимать кадр перед разбором
// Центр кадра без ужатия. Камера отдаёт 1280–1920 точек в ширину, а полоса
// ужимается до 900: у дальнего или мелкого кода (EAN-8 на йогурте) штрих
// становится тоньше пикселя и пропадает. Через кадр разбираем середину в
// исходном разрешении — это «цифровой зум» без потери резкости.
const ZOOM_SIDE = 640
const ZOOM_EVERY = 2
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

// Непрерывная фокусировка там, где камера её умеет. Без неё часть телефонов
// фокусируется один раз при старте — на чём-то вдали — и штрихкод у самой
// камеры так и остаётся мыльным. Не умеет — молча работаем как раньше.
async function tuneTrack(track) {
  try {
    const caps = track.getCapabilities?.() || {}
    const advanced = []
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) advanced.push({ focusMode: 'continuous' })
    if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) advanced.push({ exposureMode: 'continuous' })
    if (advanced.length) await track.applyConstraints({ advanced })
    return { torch: caps.torch === true }
  } catch {
    return { torch: false }
  }
}

// onFound(food)            — товар найден (свой или из базы), food.barcode = код;
// onManual(name, drink)    — ручной ввод: камеры нет или человек так решил;
// onMissing(draft)         — кода нет в базе или у товара нет состава: завести
//                            свой продукт. Не передан — уходим в ручной ввод;
// findOwn(code)            — свой продукт по коду (или null);
// zIndex                   — поверх чего открывается (сканер из редактора
//                            продукта живёт выше листа).
export default function BarcodeScanner({ onClose, onFound, onManual, onMissing, findOwn, zIndex }) {
  // starting → scanning — рабочий путь; остальное это отказы, у каждого свой текст.
  const [phase, setPhase] = useState('starting')
  // Что показываем поверх камеры: поиск товара, «не найден», «нет связи».
  const [result, setResult] = useState(null)
  const [hint, setHint] = useState(false)
  const [torch, setTorch] = useState({ available: false, on: false })

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  const zoomCanvasRef = useRef(null)
  const rafRef = useRef(0)
  const lastScanRef = useRef(0)
  const frameRef = useRef(0)
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
  const findOwnRef = useRef(findOwn)
  findOwnRef.current = findOwn

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

  const finish = useCallback((fn) => {
    aliveRef.current = false
    stopCamera()
    fn()
  }, [stopCamera])

  // Код прочитан и подтверждён — ищем товар. Камеру не гасим: если товара нет,
  // человек тут же наведётся на другой.
  const handleCode = useCallback(async (code) => {
    pausedRef.current = true
    setHint(false)
    if (navigator.vibrate) { try { navigator.vibrate(30) } catch {} }

    // Свой продукт — сразу, без сети и без экрана «Ищем…».
    const own = findOwnRef.current?.(code)
    if (own) { finish(() => onFound({ ...own, barcode: own.barcode || code })); return }

    setResult({ status: 'looking', code })
    try {
      const found = await lookupBarcode(code)
      if (!aliveRef.current) return
      if (found.status === 'ok') {
        finish(() => onFound(found.food))
        return
      }
      if (found.status === 'no-nutrition') {
        // Название нашли — второй раз вводить его руками человек не должен.
        if (onMissing) finish(() => onMissing({ ...found.draft, barcode: code }))
        else finish(() => onManual(found.name, found.drink))
        return
      }
      rejectedRef.current.add(code)
      setResult({ status: 'not-found', code })
    } catch {
      if (!aliveRef.current) return
      setResult({ status: 'offline', code })
    }
  }, [onFound, onManual, onMissing, finish])

  const scanAgain = useCallback(() => {
    tallyRef.current.clear()
    setResult(null)
    pausedRef.current = false
    lastScanRef.current = 0
    startedRef.current = performance.now()
  }, [])

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks?.()[0]
    if (!track) return
    const on = !torch.on
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] })
      setTorch((s) => ({ ...s, on }))
    } catch {
      setTorch({ available: false, on: false })
    }
  }, [torch.on])

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
      // хотя единственная камера там вполне рабочая. Разрешение повыше: штрих
      // дальнего кода должен оставаться шире пикселя (см. ZOOM_SIDE).
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
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
      const track = stream.getVideoTracks?.()[0]
      if (track) {
        const caps = await tuneTrack(track)
        if (!cancelled && caps.torch) setTorch({ available: true, on: false })
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

    const grab = (ref, video, sx, sy, sw, sh, width, height) => {
      let canvas = ref.current
      if (!canvas) canvas = ref.current = document.createElement('canvas')
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height)
      return toLuma(ctx.getImageData(0, 0, width, height).data, width, height)
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

      const vw = video.videoWidth
      const vh = video.videoHeight
      frameRef.current += 1

      // Через кадр — середина в исходном разрешении, с диагоналями: мелкий или
      // дальний код и код под углом. Диагонали по ужатой полосе не гоняем —
      // штрих по ним и так в √2 раза уже (см. scanLuma).
      if (frameRef.current % ZOOM_EVERY === 0) {
        const side = Math.min(ZOOM_SIDE, vw, vh)
        const sx = Math.round((vw - side) / 2)
        const sy = Math.round((vh - side) / 2)
        const luma = grab(zoomCanvasRef, video, sx, sy, side, side, side, side)
        const hit = scanLuma(luma, side, side, { rows: 10, cols: 8, diagonals: 8 })
        if (hit) for (let i = 0; i < hit.hits; i++) bump(hit.code)
        return
      }

      // Свой разбор: берём широкую полосу по центру кадра — заведомо шире
      // нарисованной рамки, чтобы всё, что человек в неё поместил, точно попало.
      const bandH = Math.round(vh * 0.42)
      const bandY = Math.round((vh - bandH) / 2)
      const width = Math.min(vw, SCAN_WIDTH)
      const height = Math.max(1, Math.round((bandH * width) / vw))
      const hit = scanLuma(grab(canvasRef, video, 0, bandY, vw, bandH, width, height), width, height, { diagonals: 0 })
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

  const failure = FAILURES.has(phase)
    ? { title: t(`scanner.fail.${phase}.title`), text: t(`scanner.fail.${phase}.text`) }
    : null

  const manual = () => finish(() => onManual(''))

  const view = (
    <div className="scanner" style={zIndex ? { zIndex } : undefined} onClick={(e) => e.stopPropagation()}>
      <video ref={videoRef} className="scanner-video" playsInline muted autoPlay />

      <div className="scanner-top">
        <span className="scanner-title">{t('scanner.title')}</span>
        <span className="row gap8" style={{ alignItems: 'center' }}>
          {torch.available && phase === 'scanning' && (
            <button
              className={`scanner-x${torch.on ? ' on' : ''}`}
              onClick={toggleTorch}
              aria-label={torch.on ? t('scanner.torchOff') : t('scanner.torchOn')}
              aria-pressed={torch.on}
            >🔦</button>
          )}
          <button className="scanner-x" onClick={close} aria-label={t('common.close')}>✕</button>
        </span>
      </div>

      {phase === 'scanning' && !result && (
        <>
          <div className="scanner-frame">
            <i className="c tl" /><i className="c tr" /><i className="c bl" /><i className="c br" />
            <div className="scanner-beam" />
          </div>
          <p className="scanner-hint">{t('scanner.aim')}</p>
          {hint && (
            <p className="scanner-tip">
              {torch.available && !torch.on ? t('scanner.tipTorch') : t('scanner.tip')}
            </p>
          )}
        </>
      )}

      {phase === 'starting' && <p className="scanner-hint">{t('scanner.starting')}</p>}

      {failure && (
        <div className="scanner-card">
          <h3>{failure.title}</h3>
          <p>{failure.text}</p>
          <button className="btn" onClick={manual}>{t('scanner.manual')}</button>
        </div>
      )}

      {result?.status === 'looking' && (
        <div className="scanner-card">
          <h3>{t('scanner.looking')}</h3>
          <p className="scanner-code">{result.code}</p>
        </div>
      )}

      {result?.status === 'not-found' && (
        <div className="scanner-card">
          <h3>{t('scanner.notFound')}</h3>
          <p>{onMissing ? t('scanner.notFoundMine') : t('scanner.notFoundText')}</p>
          <p className="scanner-code">{result.code}</p>
          {onMissing ? (
            <>
              <button className="btn" onClick={() => finish(() => onMissing({ barcode: result.code }))}>{t('scanner.addMine')}</button>
              <button className="btn ghost" onClick={manual}>{t('scanner.manual')}</button>
            </>
          ) : (
            <button className="btn" onClick={manual}>{t('scanner.manual')}</button>
          )}
          <button className="btn ghost" onClick={scanAgain}>{t('scanner.again')}</button>
        </div>
      )}

      {result?.status === 'offline' && (
        <div className="scanner-card">
          <h3>{t('scanner.offline')}</h3>
          <p>{onMissing ? t('scanner.offlineMine') : t('scanner.offlineText')}</p>
          <p className="scanner-code">{result.code}</p>
          <button className="btn" onClick={() => handleCode(result.code)}>{t('common.retry')}</button>
          {onMissing && (
            <button className="btn ghost" onClick={() => finish(() => onMissing({ barcode: result.code }))}>{t('scanner.addMine')}</button>
          )}
          <button className="btn ghost" onClick={manual}>{t('scanner.manual')}</button>
        </div>
      )}

      <div className="scanner-bottom">
        <button className="btn ghost scanner-cancel" onClick={close}>{t('common.cancel')}</button>
      </div>
    </div>
  )
  // Поверх листа или push-панели сканер выносится в body: у них transform, и
  // position:fixed внутри считался бы от них, а не от экрана.
  return zIndex && typeof document !== 'undefined' ? createPortal(view, document.body) : view
}

// Отказы камеры. Текст должен говорить, что делать дальше, а не как называется
// исключение в браузере. Тексты — в словаре: scanner.fail.<причина>.
const FAILURES = new Set(['denied', 'nocamera', 'busy', 'insecure', 'unsupported', 'failed'])
