// Читает файл-картинку, кадрирует по центру в квадрат и сжимает в компактный
// data URL (JPEG), чтобы аватар помещался в синхронизируемый JSON-профиль.
import { t } from './i18n.js'

export function fileToAvatar(file, size = 256) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) return reject(new Error(t('socialErr.notImage')))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        const s = Math.min(img.width, img.height)
        const sx = (img.width - s) / 2
        const sy = (img.height - s) / 2
        ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      } catch (e) {
        reject(e)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(t('socialErr.photoRead')))
    }
    img.src = url
  })
}
