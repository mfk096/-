import * as XLSX from 'xlsx'
import type { WorkBook } from 'xlsx'

export function workbookBytes(book: WorkBook): Uint8Array {
  const out = XLSX.write(book, { bookType: 'xlsx', type: 'array', cellDates: true }) as
    | Uint8Array
    | ArrayBuffer
    | number[]
  if (out instanceof Uint8Array) return out
  if (out instanceof ArrayBuffer) return new Uint8Array(out)
  return Uint8Array.from(out)
}

export function downloadWorkbook(book: WorkBook, filename: string) {
  const bytes = workbookBytes(book)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const blob = new Blob([copy], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
