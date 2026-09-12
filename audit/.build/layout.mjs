// Раскладка: заголовки, абзацы, таблицы с переносом, врезки, номера страниц.
import { PDF } from './pdflib.mjs'

const FONTS = {
  reg: '/System/Library/Fonts/Supplemental/Arial.ttf',
  bold: '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  ital: '/System/Library/Fonts/Supplemental/Arial Italic.ttf',
  mono: '/System/Library/Fonts/Supplemental/Courier New.ttf',
}

export const C = {
  ink: [0.11, 0.12, 0.14],
  ink2: [0.38, 0.40, 0.44],
  ink3: [0.55, 0.57, 0.61],
  rule: [0.85, 0.86, 0.88],
  band: [0.96, 0.965, 0.975],
  accent: [0.85, 0.42, 0.13],
  p0: [0.72, 0.11, 0.11],
  p1: [0.85, 0.36, 0.05],
  p2: [0.72, 0.56, 0.04],
  p3: [0.25, 0.45, 0.72],
  p4: [0.42, 0.45, 0.50],
  ok: [0.13, 0.50, 0.30],
  white: [1, 1, 1],
}
export const SEV_COLOR = { P0: C.p0, P1: C.p1, P2: C.p2, P3: C.p3, P4: C.p4 }

export class Doc {
  constructor() {
    this.pdf = new PDF()
    this.f = {}
    for (const [k, p] of Object.entries(FONTS)) this.f[k] = this.pdf.addFont(k, p)
    this.M = { l: 52, r: 52, t: 62, b: 58 }
    this.CW = this.pdf.W - this.M.l - this.M.r
    this.page = null
    this.y = 0
    this.pageNo = 0
    this.toc = []
    this.anchors = new Map()
    this.suppressChrome = false
  }
  get x0() { return this.M.l }

  newPage() {
    this.page = this.pdf.newPage()
    this.pageNo++
    this.y = this.pdf.H - this.M.t
    if (!this.suppressChrome) this._chrome()
    return this.page
  }
  _chrome() {
    const p = this.page
    this.pdf.text(p, { x: this.M.l, y: this.pdf.H - 38, size: 7.5, font: 'reg', str: 'EATAPS — ПОЛНЫЙ АУДИТ ПРИЛОЖЕНИЯ', color: C.ink3, charSpace: 0.7 })
    this.pdf.text(p, { x: this.pdf.W - this.M.r - this.f.reg.widthOf('6034515', 7.5), y: this.pdf.H - 38, size: 7.5, font: 'reg', str: '6034515', color: C.ink3 })
    this.pdf.line(p, this.M.l, this.pdf.H - 46, this.pdf.W - this.M.r, this.pdf.H - 46, C.rule, 0.5)
    const n = String(this.pageNo)
    this.pdf.line(p, this.M.l, this.M.b - 14, this.pdf.W - this.M.r, this.M.b - 14, C.rule, 0.5)
    this.pdf.text(p, { x: (this.pdf.W - this.f.reg.widthOf(n, 8.5)) / 2, y: this.M.b - 26, size: 8.5, font: 'reg', str: n, color: C.ink3 })
  }
  need(h) { if (this.y - h < this.M.b) this.newPage() }
  gap(h) { this.y -= h }

  // ── Перенос по словам ─────────────────────────────────────────────────────
  wrap(str, font, size, width, keepIndent = false) {
    const f = this.f[font]
    const out = []
    for (let para of String(str).split('\n')) {
      if (!keepIndent) para = para.replace(/^\s+/, '')
      const words = para.split(/ /)
      let line = ''
      for (let w of words) {
        // Слово длиннее строки — рубим посимвольно (длинные пути/URL).
        while (f.widthOf(w, size) > width) {
          let cut = ''
          for (const ch of w) { if (f.widthOf(cut + ch, size) > width) break; cut += ch }
          if (!cut) break
          if (line) { out.push(line); line = '' }
          out.push(cut)
          w = w.slice(cut.length)
        }
        const cand = line ? line + ' ' + w : w
        if (f.widthOf(cand, size) <= width) line = cand
        else { if (line) out.push(line); line = w }
      }
      out.push(line)
    }
    return out
  }

  h1(str, { anchor } = {}) {
    this.newPage()
    if (anchor) this.anchors.set(anchor, this.pageNo - 1)
    this.toc.push({ level: 1, str, page: this.pageNo })
    this.pdf.rect(this.page, this.M.l, this.y - 4, 34, 3, C.accent)
    this.y -= 26
    for (const ln of this.wrap(str, 'bold', 20, this.CW)) {
      this.pdf.text(this.page, { x: this.x0, y: this.y, size: 20, font: 'bold', str: ln, color: C.ink })
      this.y -= 25
    }
    this.y -= 12
  }
  h2(str, { anchor } = {}) {
    this.need(74)
    this.y -= 16
    if (anchor) this.anchors.set(anchor, this.pageNo - 1)
    this.toc.push({ level: 2, str, page: this.pageNo })
    for (const ln of this.wrap(str, 'bold', 13.5, this.CW)) {
      this.pdf.text(this.page, { x: this.x0, y: this.y, size: 13.5, font: 'bold', str: ln, color: C.ink })
      this.y -= 17
    }
    this.y -= 3
    this.pdf.line(this.page, this.x0, this.y + 6, this.x0 + this.CW, this.y + 6, C.rule, 0.5)
    this.y -= 9
  }
  h3(str) {
    this.need(46)
    this.y -= 10
    for (const ln of this.wrap(str, 'bold', 10.5, this.CW)) {
      this.pdf.text(this.page, { x: this.x0, y: this.y, size: 10.5, font: 'bold', str: ln, color: C.ink })
      this.y -= 14
    }
    this.y -= 2
  }
  p(str, { size = 9.5, color = C.ink, lead = 13.6, font = 'reg', indent = 0 } = {}) {
    const w = this.CW - indent
    for (const ln of this.wrap(str, font, size, w)) {
      this.need(lead)
      this.pdf.text(this.page, { x: this.x0 + indent, y: this.y, size, font, str: ln, color })
      this.y -= lead
    }
    this.y -= 3
  }
  bullet(str, { marker = '•', size = 9.5, color = C.ink } = {}) {
    const ind = 14
    const lines = this.wrap(str, 'reg', size, this.CW - ind)
    lines.forEach((ln, i) => {
      this.need(13.2)
      if (i === 0) this.pdf.text(this.page, { x: this.x0 + 3, y: this.y, size, font: 'reg', str: marker, color: C.ink3 })
      this.pdf.text(this.page, { x: this.x0 + ind, y: this.y, size, font: 'reg', str: ln, color })
      this.y -= 13.2
    })
    this.y -= 1.5
  }
  kv(k, v, { kw = 132, size = 9.5 } = {}) {
    const lines = this.wrap(v, 'reg', size, this.CW - kw)
    lines.forEach((ln, i) => {
      this.need(13.2)
      if (i === 0) this.pdf.text(this.page, { x: this.x0, y: this.y, size, font: 'bold', str: k, color: C.ink2 })
      this.pdf.text(this.page, { x: this.x0 + kw, y: this.y, size, font: 'reg', str: ln, color: C.ink })
      this.y -= 13.2
    })
  }
  code(str) {
    const size = 8.2, lead = 11.4, pad = 7
    const lines = []
    for (const raw of String(str).split('\n')) lines.push(...this.wrap(raw, 'mono', size, this.CW - pad * 2, true))
    let i = 0
    while (i < lines.length) {
      const avail = Math.max(1, Math.floor((this.y - this.M.b - pad * 2) / lead))
      if (avail < 2 && i < lines.length) { this.newPage(); continue }
      const take = lines.slice(i, i + avail)
      const h = take.length * lead + pad * 2
      this.pdf.rect(this.page, this.x0, this.y - h + lead - 3, this.CW, h, C.band)
      let yy = this.y - pad
      for (const ln of take) { this.pdf.text(this.page, { x: this.x0 + pad, y: yy, size, font: 'mono', str: ln, color: C.ink }); yy -= lead }
      this.y = this.y - h - 4
      i += avail
    }
    this.y -= 4
  }
  note(str, { color = C.accent, title = null } = {}) {
    const pad = 8, size = 9
    const lines = []
    if (title) lines.push({ t: title, b: true })
    for (const ln of this.wrap(str, 'reg', size, this.CW - pad * 2 - 6)) lines.push({ t: ln })
    const h = lines.length * 12.8 + pad * 2
    this.need(h + 6)
    this.pdf.rect(this.page, this.x0, this.y - h + 10, this.CW, h, C.band)
    this.pdf.rect(this.page, this.x0, this.y - h + 10, 2.6, h, color)
    let yy = this.y - pad + 1
    for (const l of lines) { this.pdf.text(this.page, { x: this.x0 + pad + 6, y: yy, size, font: l.b ? 'bold' : 'reg', str: l.t, color: C.ink }); yy -= 12.8 }
    this.y = this.y - h - 6
  }
  badge(sev, x, y) {
    const col = SEV_COLOR[sev] || C.p4
    const w = this.f.bold.widthOf(sev, 7.6) + 10
    this.pdf.rect(this.page, x, y - 2.6, w, 11.6, col)
    this.pdf.text(this.page, { x: x + 5, y, size: 7.6, font: 'bold', str: sev, color: C.white })
    return w
  }

  // ── Таблица ───────────────────────────────────────────────────────────────
  // cols: [{ t, w (доля), align }] ; rows: [[...]] ; cell может быть {t, sev, bold, color}
  table(cols, rows, { size = 8.3, lead = 11, pad = 5, headBg = C.band, zebra = true } = {}) {
    const total = cols.reduce((s, c) => s + c.w, 0)
    const widths = cols.map((c) => (c.w / total) * this.CW)
    const xs = []; let acc = this.x0
    for (const w of widths) { xs.push(acc); acc += w }

    const drawHead = () => {
      const hl = cols.map((c, i) => this.wrap(c.t, 'bold', size, widths[i] - pad * 2))
      const hh = Math.max(...hl.map((l) => l.length)) * lead + pad * 2 - 2
      this.need(hh + lead * 2)
      this.pdf.rect(this.page, this.x0, this.y - hh + lead - 1, this.CW, hh, headBg)
      hl.forEach((lines, i) => {
        let yy = this.y - pad + 1
        for (const ln of lines) { this.pdf.text(this.page, { x: xs[i] + pad, y: yy, size, font: 'bold', str: ln, color: C.ink2 }); yy -= lead }
      })
      this.y -= hh
      this.pdf.line(this.page, this.x0, this.y + lead - 1, this.x0 + this.CW, this.y + lead - 1, C.rule, 0.7)
    }
    drawHead()

    rows.forEach((row, ri) => {
      const cells = row.map((c) => (typeof c === 'object' && c !== null ? c : { t: String(c ?? '') }))
      const laid = cells.map((c, i) => {
        const extra = c.sev ? this.f.bold.widthOf(c.sev, 7.6) + 14 : 0
        return this.wrap(c.t, c.bold ? 'bold' : 'reg', size, widths[i] - pad * 2 - extra)
      })
      const h = Math.max(1, ...laid.map((l) => l.length)) * lead + pad * 2 - 3
      if (this.y - h < this.M.b) { this.newPage(); drawHead() }
      if (zebra && ri % 2 === 1) this.pdf.rect(this.page, this.x0, this.y - h + lead - 1, this.CW, h, [0.975, 0.978, 0.984])
      laid.forEach((lines, i) => {
        let yy = this.y - pad + 1
        let x = xs[i] + pad
        if (cells[i].sev) x += this.badge(cells[i].sev, xs[i] + pad, yy) + 4
        lines.forEach((ln, li) => {
          let xx = li === 0 ? x : xs[i] + pad
          if (cells[i].align === 'r') xx = xs[i] + widths[i] - pad - this.f[cells[i].bold ? 'bold' : 'reg'].widthOf(ln, size)
          this.pdf.text(this.page, { x: xx, y: yy, size, font: cells[i].bold ? 'bold' : 'reg', str: ln, color: cells[i].color || C.ink })
          yy -= lead
        })
      })
      this.y -= h
      this.pdf.line(this.page, this.x0, this.y + lead - 1, this.x0 + this.CW, this.y + lead - 1, C.rule, 0.35)
    })
    this.y -= 10
  }

  save(path) {
    const { writeFileSync } = require('node:fs')
    writeFileSync(path, this.pdf.build())
  }
}
