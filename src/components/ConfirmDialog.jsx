import { useState } from 'react'
import { createPortal } from 'react-dom'

// Общий диалог подтверждения «Да / Нет».
//
// captcha={true} добавляет второй шаг с вводом кода — для необратимых действий
// (удаление аккаунта, сброс профиля), чтобы их нельзя было запустить случайным
// тапом. Для обычных подтверждений шаг не нужен и включать его не надо.
//
// Рисуется порталом в body. Это не украшательство: у панелей (.push-screen,
// .chat-overlay) стоит will-change: transform, а он делает их containing block
// для position: fixed. Диалог, отрисованный внутри прокрученной панели,
// оказывался на 600 px выше экрана — кнопка «Удалить аккаунт» выглядела просто
// неработающей. Модальному окну место на body, а не в поддереве вызывающего.
export default function ConfirmDialog({ text, onYes, onNo, captcha = false, yesLabel = 'Да', noLabel = 'Нет' }) {
  const [step, setStep] = useState('confirm') // 'confirm' | 'captcha'
  const [code] = useState(() => String(Math.floor(1000 + Math.random() * 9000)))
  const [input, setInput] = useState('')

  const confirmYes = () => (captcha ? setStep('captcha') : onYes())

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 24px',
    }} onClick={onNo}>
      <div style={{
        background: 'var(--surface-solid)',
        borderRadius: 20,
        padding: '28px 24px 20px',
        maxWidth: 360,
        width: '100%',
        boxShadow: 'var(--shadow-float)',
      }} onClick={e => e.stopPropagation()}>
        {step === 'confirm' ? (
          <>
            <p style={{ fontSize: 16, lineHeight: 1.5, color: 'var(--ink)', marginBottom: 24, textAlign: 'center' }}>{text}</p>
            <div className="row gap12">
              <button className="btn ghost" style={{ flex: 1 }} onClick={onNo}>{noLabel}</button>
              <button className="btn" style={{ flex: 1, background: 'var(--danger)', borderColor: 'var(--danger)', color: 'var(--on-danger)' }} onClick={confirmYes}>{yesLabel}</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 15, color: 'var(--ink)', marginBottom: 16, textAlign: 'center', lineHeight: 1.5 }}>
              Введите код для подтверждения
            </p>
            <div style={{
              fontSize: 32, fontWeight: 700, letterSpacing: 10,
              textAlign: 'center', color: 'var(--ink)',
              background: 'var(--surface-2)', borderRadius: 12,
              padding: '12px 0', marginBottom: 16,
              userSelect: 'none',
            }}>{code}</div>
            <input
              autoFocus
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Введите код"
              inputMode="numeric"
              maxLength={4}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '10px 14px', borderRadius: 12,
                border: `1.5px solid ${input && input !== code.slice(0, input.length) ? 'var(--danger)' : 'var(--border)'}`,
                background: 'var(--surface-2)', color: 'var(--ink)',
                fontSize: 20, fontWeight: 600, letterSpacing: 6,
                textAlign: 'center', outline: 'none', marginBottom: 16,
              }}
              onKeyDown={e => { if (e.key === 'Enter' && input === code) onYes() }}
            />
            <div className="row gap12">
              <button className="btn ghost" style={{ flex: 1 }} onClick={onNo}>Отмена</button>
              <button className="btn" style={{ flex: 1, background: 'var(--danger)', borderColor: 'var(--danger)', color: 'var(--on-danger)' }} disabled={input !== code} onClick={onYes}>Подтвердить</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
