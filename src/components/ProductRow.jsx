import { useState, useMemo } from 'react'
import { FOODS, searchLocal, unitLabel, macroLabel, hasMacros } from '../lib/foods.js'
import { foodName } from '../lib/foodNames.js'
import { t, locale } from '../lib/i18n.js'
import { useSearchNames } from '../lib/useSearchNames.js'
import { productsAsFoods, sortProducts, productLabel } from '../lib/myProducts.js'

// Общие куски раздела «Мои продукты»: строка списка, плитка, фильтр и продукт
// базы по id. Живут отдельно от экрана раздела, потому что нужны и листу
// добавления (он в стартовом бандле), и самому экрану (ленивый чанк).

// Чем может быть продукт базы, вариантом которого назван свой: простой
// продукт с цифрами, а не конструктор и не составное блюдо.
export const BASE_POOL = FOODS.filter((f) => !f.builder && f.kind !== 'composite' && f.foodId && f.kcal != null)
const BASE_BY_ID = new Map(BASE_POOL.map((f) => [f.foodId, f]))
export const baseFoodOf = (id) => (id ? BASE_BY_ID.get(id) || null : null)

// Подпись строки: калорийность, БЖУ и «вариант чего» — по этому человек
// отличает свою Гауду от соседней.
export function productMeta(p) {
  const unit = unitLabel(p.unit || 'г')
  const parts = [t('add.kcalPer100', { n: p.kcal, unit })]
  if (hasMacros(p)) parts.push(macroLabel(p))
  const base = baseFoodOf(p.baseId)
  if (base) parts.push(t('products.variantOf', { name: foodName(base.name) }))
  return parts.join(' · ')
}

export function ProductRow({ p, onOpen, onEdit, quickLabel, onQuick }) {
  const label = productLabel(p)
  return (
    <div className="meal-item" style={{ gap: 8 }}>
      <button
        onClick={onOpen}
        style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'start', flex: 1, minWidth: 0, minHeight: 44 }}
      >
        <ProductThumb photo={p.photo} emoji={p.emoji || '🛒'} size={40} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="meal-name" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          <span className="meal-meta" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{productMeta(p)}</span>
        </span>
        {!quickLabel && !onEdit && <span style={{ color: 'var(--ink-3)', fontSize: 18, flex: '0 0 auto' }}>›</span>}
      </button>
      {quickLabel && (
        <button
          onClick={onQuick}
          aria-label={t('add.logName', { name: label, amount: quickLabel })}
          className="chip"
          style={{ flex: '0 0 auto', minHeight: 44, padding: '10px 12px', fontWeight: 600, color: 'var(--primary)' }}
        >＋ {quickLabel}</button>
      )}
      {onEdit && (
        <button
          onClick={onEdit}
          aria-label={t('products.editAria', { name: label })}
          style={{ width: 40, height: 44, flex: '0 0 auto', color: 'var(--ink-3)', fontSize: 16 }}
        >✎</button>
      )}
    </div>
  )
}

// Отфильтрованный список: поиск — тот же, что везде (опечатки, раскладка, все
// языки), и находит продукт ещё и по продукту базы: «сыр» находит свою Гауду
// (см. productEntity в search/index.js).
export function useProductFilter(products, query) {
  const namesReady = useSearchNames()
  const foods = useMemo(() => productsAsFoods(products), [products])
  return useMemo(() => {
    const q = query.trim()
    if (!q) return sortProducts(products, locale())
    const ids = searchLocal(q, { items: foods }).map((f) => f.productId)
    const byId = new Map(products.map((p) => [p.id, p]))
    return ids.map((id) => byId.get(id)).filter(Boolean)
  }, [products, foods, query, namesReady])
}

// Плитка продукта: фото упаковки, если есть, иначе значок. Не загрузилось —
// тот же значок того же размера: интерфейс не прыгает.
export function ProductThumb({ photo, emoji, size = 52 }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="meal-emoji" style={{ width: size, height: size, fontSize: Math.round(size * 0.46), overflow: 'hidden', padding: 0, flex: '0 0 auto' }}>
      {photo && !failed ? (
        <img src={photo} alt="" loading="lazy" width={size} height={size} onError={() => setFailed(true)}
          style={{ width: size, height: size, objectFit: 'cover', display: 'block' }} />
      ) : emoji}
    </span>
  )
}
