import { useState, Suspense } from 'react'
import { useStore } from '../store.jsx'
import { t } from '../lib/i18n.js'
import { lazyWithReload } from '../lib/lazyWithReload.js'
import { productAsFood, findProductByBarcode, productById, productLabel } from '../lib/myProducts.js'
import ProductEditorSheet from './ProductEditorSheet.jsx'
import { ProductRow, useProductFilter } from './ProductRow.jsx'
import Toast from './Toast.jsx'

const BarcodeScanner = lazyWithReload(() => import('./BarcodeScanner.jsx'))

// ─────────────────────────────────────────────────────────────────────────────
// Раздел «Мои продукты»: то, что человек покупает. Отсюда их заводят (руками
// или по штрихкоду), правят и удаляют; добавляют в дневник — из листа
// добавления, там они идут отдельной категорией и находятся поиском.
// ─────────────────────────────────────────────────────────────────────────────

// Сколько продуктов показать, прежде чем появится поиск по ним.
const FILTER_FROM = 6

export default function MyProductsScreen({ onClose }) {
  const { products } = useStore()
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState(null) // null | { product } | { draft, note }
  const [scanning, setScanning] = useState(false)
  const [toast, setToast] = useState(null)
  const shown = useProductFilter(products, query)

  const showToast = (msg) => setToast({ msg, at: Date.now() })

  // Своё по штрихкоду — открываем его же на правку: второй раз заводить ту же
  // пачку незачем.
  const findOwn = (code) => {
    const p = findProductByBarcode(products, code)
    return p ? productAsFood(p) : null
  }
  const onScanned = (food) => {
    setScanning(false)
    const own = food.productId ? productById(products, food.productId) : null
    if (own) { setEditor({ product: own }); showToast(t('products.alreadyMine', { name: productLabel(own) })); return }
    setEditor({ draft: food, note: 'filled' })
  }

  return (
    <div className="screen">
      <Toast toast={toast} onDone={() => setToast(null)} />
      <div className="row gap8" style={{ alignItems: 'center', marginBottom: 8 }}>
        <button className="iconbtn" onClick={onClose} aria-label={t('common.back')} style={{ fontSize: 22, flex: '0 0 auto' }}>‹</button>
        <h1 className="h1" style={{ margin: 0, fontSize: 24 }}>{t('products.title')}</h1>
      </div>
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, margin: '0 0 16px' }}>{t('products.intro')}</p>

      <div className="row gap8" style={{ marginBottom: 16 }}>
        <button className="btn" style={{ flex: 1, marginTop: 0, height: 48 }} onClick={() => setEditor({ draft: {} })}>＋ {t('products.add')}</button>
        <button className="btn soft" style={{ flex: 1, marginTop: 0, height: 48 }} onClick={() => setScanning(true)}>📷 {t('products.scan')}</button>
      </div>

      {products.length >= FILTER_FROM && (
        <input
          className="input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder={t('products.searchPh')}
          aria-label={t('products.searchPh')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
          style={{ marginBottom: 12 }}
        />
      )}

      {products.length === 0 ? (
        <div className="card" style={{ padding: 16, boxShadow: 'none', background: 'var(--surface-2)', border: 'none' }}>
          <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: 0 }}>{t('products.empty')}</p>
        </div>
      ) : (
        <>
          <div className="row between" style={{ margin: '2px 0 8px' }}>
            <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              {t('products.count', { count: products.length })}
            </span>
          </div>
          {shown.map((p) => (
            <ProductRow key={p.id} p={p} onOpen={() => setEditor({ product: p })} />
          ))}
          {shown.length === 0 && (
            <p className="muted" style={{ fontSize: 14, padding: '8px 0' }}>{t('products.nothingFound')}</p>
          )}
        </>
      )}

      {editor && (
        <ProductEditorSheet
          product={editor.product}
          draft={editor.draft}
          note={editor.note}
          onClose={() => setEditor(null)}
          onSaved={(entry, { updated }) => showToast(t(updated ? 'products.updated' : 'products.saved', { name: productLabel(entry) }))}
          onDeleted={() => showToast(t('products.deleted'))}
        />
      )}

      {scanning && (
        <Suspense fallback={null}>
          <BarcodeScanner
            zIndex={90}
            findOwn={findOwn}
            onClose={() => setScanning(false)}
            onFound={onScanned}
            onMissing={(draft) => { setScanning(false); setEditor({ draft }) }}
            onManual={() => { setScanning(false); setEditor({ draft: {} }) }}
          />
        </Suspense>
      )}
    </div>
  )
}
