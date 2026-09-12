// ─────────────────────────────────────────────────────────────────────────────
// Минимальный генератор PDF без внешних зависимостей, с ВСТРАИВАНИЕМ
// TrueType-шрифтов (CIDFontType2 / Identity-H) — иначе кириллица в PDF
// невозможна: стандартные 14 шрифтов PDF кодируются WinAnsi и русских букв
// не содержат вовсе.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

// ── Разбор TTF ───────────────────────────────────────────────────────────────
export class TTF {
  constructor(path) {
    const b = this.buf = readFileSync(path)
    const numTables = b.readUInt16BE(4)
    this.tables = {}
    let off = 12
    for (let i = 0; i < numTables; i++) {
      this.tables[b.toString('latin1', off, off + 4)] = { off: b.readUInt32BE(off + 8), len: b.readUInt32BE(off + 12) }
      off += 16
    }
    const head = this.tables.head.off
    this.unitsPerEm = b.readUInt16BE(head + 18)
    this.bbox = [b.readInt16BE(head + 36), b.readInt16BE(head + 38), b.readInt16BE(head + 40), b.readInt16BE(head + 42)]
    this.numGlyphs = b.readUInt16BE(this.tables.maxp.off + 4)
    const hhea = this.tables.hhea.off
    this.ascent = b.readInt16BE(hhea + 4)
    this.descent = b.readInt16BE(hhea + 6)
    this.numHMetrics = b.readUInt16BE(hhea + 34)
    this.italicAngle = b.readInt32BE(this.tables.post.off + 4) / 65536
    this._cmap = this._parseCmap()
    this._widthCache = new Map()
  }

  _parseCmap() {
    const b = this.buf, base = this.tables.cmap.off
    const n = b.readUInt16BE(base + 2)
    let best = null, bestScore = -1
    for (let i = 0; i < n; i++) {
      const p = base + 4 + i * 8
      const plat = b.readUInt16BE(p), enc = b.readUInt16BE(p + 2), sub = base + b.readUInt32BE(p + 4)
      const fmt = b.readUInt16BE(sub)
      // Предпочитаем формат 12 (полный Unicode), затем 4 (BMP).
      let score = -1
      if (plat === 3 && enc === 10 && fmt === 12) score = 4
      else if (plat === 0 && fmt === 12) score = 3
      else if (plat === 3 && enc === 1 && fmt === 4) score = 2
      else if (plat === 0 && fmt === 4) score = 1
      if (score > bestScore) { bestScore = score; best = { sub, fmt } }
    }
    if (!best) throw new Error('в шрифте нет пригодной таблицы cmap')
    const map = new Map()
    const { sub, fmt } = best
    if (fmt === 4) {
      const segX2 = b.readUInt16BE(sub + 6), seg = segX2 / 2
      const endO = sub + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2
      for (let s = 0; s < seg; s++) {
        const end = b.readUInt16BE(endO + s * 2), start = b.readUInt16BE(startO + s * 2)
        const delta = b.readInt16BE(deltaO + s * 2), ro = b.readUInt16BE(rangeO + s * 2)
        if (start === 0xffff) continue
        for (let c = start; c <= end && c !== 0x10000; c++) {
          let g
          if (ro === 0) g = (c + delta) & 0xffff
          else {
            const gi = rangeO + s * 2 + ro + (c - start) * 2
            if (gi + 1 >= b.length) continue
            g = b.readUInt16BE(gi)
            if (g !== 0) g = (g + delta) & 0xffff
          }
          if (g) map.set(c, g)
        }
      }
    } else {
      const nGroups = b.readUInt32BE(sub + 12)
      for (let i = 0; i < nGroups; i++) {
        const p = sub + 16 + i * 12
        const s = b.readUInt32BE(p), e = b.readUInt32BE(p + 4), gs = b.readUInt32BE(p + 8)
        for (let c = s; c <= e; c++) map.set(c, gs + (c - s))
      }
    }
    return map
  }

  gid(cp) { return this._cmap.get(cp) ?? 0 }

  // Ширина глифа в единицах 1/1000 em (как требует PDF).
  gwidth(gid) {
    if (this._widthCache.has(gid)) return this._widthCache.get(gid)
    const b = this.buf, hm = this.tables.hmtx.off
    const i = Math.min(gid, this.numHMetrics - 1)
    const adv = b.readUInt16BE(hm + i * 4)
    const w = Math.round(adv * 1000 / this.unitsPerEm)
    this._widthCache.set(gid, w)
    return w
  }

  // Подстановка символов, которых в Arial нет. Без неё эмодзи превращались бы
  // в «?» прямо посреди таблицы статусов — хуже, чем их отсутствие.
  static SUBST = new Map(Object.entries({
    '\u{1F7E0}': '', '\u2705': '', '\u26A0': '', '\uFE0F': '', '\u274C': '',
    '\u{1F6A8}': '', '\u{1F7E1}': '', '\u{1F534}': '', '\u{1F7E2}': '',
    '\u2714': '\u25CF', '\u2715': '\u00D7', '\u2716': '\u00D7',
    '\u25D0': '\u25CB', '\u20BD': 'RUB', '\u{1F4A1}': '', '\u{1F4C4}': '',
  }))

  // Строка → массив glyph id. Отсутствующий глиф ОТБРАСЫВАЕТСЯ, а не заменяется
  // на '?': пустое место читается лучше, чем ложный знак вопроса.
  glyphs(str) {
    const out = []
    for (const ch of str) {
      const sub = TTF.SUBST.get(ch)
      const use = sub === undefined ? ch : sub
      if (use === '') continue
      for (const c2 of use) {
        const cp = c2.codePointAt(0)
        const g = this.gid(cp)
        if (g) out.push({ g, cp })
      }
    }
    return out
  }

  widthOf(str, size) {
    let w = 0
    for (const { g } of this.glyphs(str)) w += this.gwidth(g)
    return w * size / 1000
  }
}

// ── Документ PDF ─────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c)

export class PDF {
  constructor({ width = 595.28, height = 841.89 } = {}) {   // A4
    this.W = width; this.H = height
    this.objects = ['']          // 1-based
    this.pages = []
    this.fonts = {}
    this._used = new Map()       // fontKey → Set(gid) для W-массива
  }
  alloc() { this.objects.push(null); return this.objects.length - 1 }
  put(id, body) { this.objects[id] = body }

  addFont(key, path) {
    const ttf = new TTF(path)
    this.fonts[key] = { ttf, id: null, name: 'F' + (Object.keys(this.fonts).length + 1) }
    this._used.set(key, new Set())
    return ttf
  }
  markUsed(key, gid) { this._used.get(key).add(gid) }

  newPage() { const p = { ops: [] }; this.pages.push(p); return p }

  // Текст глифами (Identity-H): <hex GID> Tj
  text(page, { x, y, size, font, str, color = [0, 0, 0], charSpace = 0 }) {
    const f = this.fonts[font]
    const gs = f.ttf.glyphs(str)
    let hex = ''
    for (const { g } of gs) { hex += g.toString(16).padStart(4, '0'); this.markUsed(font, g) }
    if (!hex) return
    const [r, g2, b] = color
    page.ops.push(`BT ${r} ${g2} ${b} rg /${f.name} ${size} Tf ${charSpace ? charSpace + ' Tc ' : ''}1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${hex}> Tj ET`)
    if (charSpace) page.ops.push('BT 0 Tc ET')
  }
  rect(page, x, y, w, h, color) {
    const [r, g, b] = color
    page.ops.push(`${r} ${g} ${b} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`)
  }
  line(page, x1, y1, x2, y2, color = [0.8, 0.8, 0.8], w = 0.5) {
    const [r, g, b] = color
    page.ops.push(`${r} ${g} ${b} RG ${w} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`)
  }
  link(page, x, y, w, h, targetPageIndex) {
    ;(page.links ||= []).push({ x, y, w, h, target: targetPageIndex })
  }

  _fontObjects() {
    for (const [key, f] of Object.entries(this.fonts)) {
      const ttf = f.ttf
      const fileId = this.alloc()
      const raw = ttf.buf
      const comp = deflateSync(raw)
      this.put(fileId, { dict: `<< /Length ${comp.length} /Filter /FlateDecode /Length1 ${raw.length} >>`, stream: comp })

      const descId = this.alloc()
      const sc = 1000 / ttf.unitsPerEm
      this.put(descId, { dict: `<< /Type /FontDescriptor /FontName /${f.psname} /Flags 4 /FontBBox [${ttf.bbox.map((v) => Math.round(v * sc)).join(' ')}] /ItalicAngle ${ttf.italicAngle} /Ascent ${Math.round(ttf.ascent * sc)} /Descent ${Math.round(ttf.descent * sc)} /CapHeight ${Math.round(ttf.ascent * sc)} /StemV 80 /FontFile2 ${fileId} 0 R >>` })

      // W: ширины только реально использованных глифов.
      const used = [...this._used.get(key)].sort((a, b) => a - b)
      let W = ''
      for (let i = 0; i < used.length;) {
        const start = used[i]; const run = [ttf.gwidth(used[i])]; let j = i + 1
        while (j < used.length && used[j] === used[j - 1] + 1) { run.push(ttf.gwidth(used[j])); j++ }
        W += `${start} [${run.join(' ')}] `
        i = j
      }
      const cidId = this.alloc()
      this.put(cidId, { dict: `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${f.psname} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descId} 0 R /DW 1000 /W [${W}] /CIDToGIDMap /Identity >>` })

      // ToUnicode — чтобы текст копировался и искался.
      const pairs = used.map((g) => {
        let cp = null
        for (const [c, gg] of ttf._cmap) if (gg === g) { cp = c; break }
        return cp == null ? null : `<${g.toString(16).padStart(4, '0')}> <${cp > 0xffff
          ? [...String.fromCodePoint(cp)].map(() => '').join('') || surrogate(cp) : cp.toString(16).padStart(4, '0')}>`
      }).filter(Boolean)
      const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /A def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange ${chunk(pairs, 100).map((c) => `${c.length} beginbfchar\n${c.join('\n')}\nendbfchar`).join('\n')} endcmap CMapName currentdict /CMap defineresource pop end end`
      const tuId = this.alloc()
      const tuc = deflateSync(Buffer.from(cmap, 'latin1'))
      this.put(tuId, { dict: `<< /Length ${tuc.length} /Filter /FlateDecode >>`, stream: tuc })

      f.id = this.alloc()
      this.put(f.id, { dict: `<< /Type /Font /Subtype /Type0 /BaseFont /${f.psname} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${tuId} 0 R >>` })
    }
  }

  build() {
    for (const [k, f] of Object.entries(this.fonts)) f.psname = 'EA' + k.replace(/[^A-Za-z]/g, '') + '+Emb'
    this._fontObjects()

    const pagesId = this.alloc()
    const fontRes = Object.values(this.fonts).map((f) => `/${f.name} ${f.id} 0 R`).join(' ')
    const pageIds = this.pages.map(() => this.alloc())

    this.pages.forEach((p, i) => {
      const content = p.ops.join('\n')
      const comp = deflateSync(Buffer.from(content, 'latin1'))
      const cId = this.alloc()
      this.put(cId, { dict: `<< /Length ${comp.length} /Filter /FlateDecode >>`, stream: comp })
      let annots = ''
      if (p.links?.length) {
        const ids = p.links.map((l) => {
          const a = this.alloc()
          this.put(a, { dict: `<< /Type /Annot /Subtype /Link /Rect [${l.x.toFixed(2)} ${l.y.toFixed(2)} ${(l.x + l.w).toFixed(2)} ${(l.y + l.h).toFixed(2)}] /Border [0 0 0] /Dest [${pageIds[l.target]} 0 R /XYZ 0 ${this.H} 0] >>` })
          return `${a} 0 R`
        })
        annots = ` /Annots [${ids.join(' ')}]`
      }
      this.put(pageIds[i], { dict: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.W.toFixed(2)} ${this.H.toFixed(2)}] /Resources << /Font << ${fontRes} >> >> /Contents ${cId} 0 R${annots} >>` })
    })

    this.put(pagesId, { dict: `<< /Type /Pages /Count ${this.pages.length} /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] >>` })
    const catId = this.alloc()
    this.put(catId, { dict: `<< /Type /Catalog /Pages ${pagesId} 0 R /PageLayout /SinglePage >>` })
    const infoId = this.alloc()
    this.put(infoId, { dict: `<< /Title (EatAps — polnyy audit) /Producer (EatAps audit toolchain) /CreationDate (D:${stamp()}) >>` })

    // Сборка байтов
    const parts = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')]
    let pos = parts[0].length
    const offsets = [0]
    for (let i = 1; i < this.objects.length; i++) {
      const o = this.objects[i]
      offsets[i] = pos
      let buf
      if (o && o.stream) buf = Buffer.concat([Buffer.from(`${i} 0 obj\n${o.dict}\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')])
      else buf = Buffer.from(`${i} 0 obj\n${(o && o.dict) || '<< >>'}\nendobj\n`, 'latin1')
      parts.push(buf); pos += buf.length
    }
    const xrefPos = pos
    let xref = `xref\n0 ${this.objects.length}\n0000000000 65535 f \n`
    for (let i = 1; i < this.objects.length; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
    xref += `trailer\n<< /Size ${this.objects.length} /Root ${catId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
    parts.push(Buffer.from(xref, 'latin1'))
    return Buffer.concat(parts)
  }
}

function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
function surrogate(cp) { const v = cp - 0x10000; return ((0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0')) }
function stamp() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` }
