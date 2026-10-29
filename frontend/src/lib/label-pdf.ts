import QRCode from 'qrcode'
import {
  chunkLabels,
  labelDetailLines,
  labelsPerPage,
  qrPayload,
  type LabelContent,
  type LabelFieldSettings,
  type LabelTemplate,
} from '@/lib/label-templates'

const PX_PER_MM = 8

function pageOrientation(width: number, height: number): 'portrait' | 'landscape' {
  return width > height ? 'landscape' : 'portrait'
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Не удалось нарисовать QR'))
    image.src = src
  })
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (ctx.measureText(next).width <= maxWidth) {
      current = next
      continue
    }
    if (current) lines.push(current)
    current = word
    if (lines.length === maxLines) break
  }
  if (lines.length < maxLines && current) lines.push(current)
  if (lines.length > maxLines) lines.length = maxLines
  const consumed = lines.join(' ')
  if (lines.length === maxLines && consumed.length < text.length) {
    const last = lines[maxLines - 1] ?? ''
    let trimmed = last
    while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
      trimmed = trimmed.slice(0, -1)
    }
    lines[maxLines - 1] = `${trimmed}…`
  }
  return lines
}

async function drawLabel(
  ctx: CanvasRenderingContext2D,
  item: LabelContent,
  template: LabelTemplate,
  settings: LabelFieldSettings,
  originX: number,
  originY: number,
) {
  const width = template.labelWidthMm * PX_PER_MM
  const height = template.labelHeightMm * PX_PER_MM
  const pad = template.paddingMm * PX_PER_MM
  const qrSize = template.qrMm * PX_PER_MM

  ctx.save()
  ctx.beginPath()
  ctx.rect(originX, originY, width, height)
  ctx.clip()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(originX, originY, width, height)

  if (template.columns > 1) {
    ctx.strokeStyle = '#b5b5b5'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.strokeRect(originX + 0.5, originY + 0.5, width - 1, height - 1)
    ctx.setLineDash([])
  }

  const qrUrl = await QRCode.toDataURL(qrPayload(item.code), {
    margin: 0,
    width: Math.round(qrSize),
    errorCorrectionLevel: 'M',
  })
  const image = await loadImage(qrUrl)
  const qrX = originX + pad
  const qrY = originY + (height - qrSize) / 2
  ctx.drawImage(image, qrX, qrY, qrSize, qrSize)

  const textX = qrX + qrSize + pad * 0.6
  const textWidth = originX + width - pad - textX
  ctx.fillStyle = '#111111'
  ctx.textBaseline = 'top'

  let codeSize = template.codeFontMm * PX_PER_MM
  const minCode = Math.max(10, codeSize * 0.7)
  ctx.font = `700 ${codeSize}px Manrope, sans-serif`
  while (codeSize > minCode && ctx.measureText(item.code).width > textWidth) {
    codeSize -= 1
    ctx.font = `700 ${codeSize}px Manrope, sans-serif`
  }

  const detailSize = template.textFontMm * PX_PER_MM
  ctx.font = `500 ${detailSize}px Manrope, sans-serif`
  const details = labelDetailLines(item, settings).flatMap((line) =>
    wrapLines(ctx, line, textWidth, line.startsWith('Инв.') || line.startsWith('SN ') ? 1 : 2),
  )
  const lineGap = detailSize * 0.28
  const blockHeight =
    codeSize + (details.length > 0 ? lineGap + details.length * (detailSize + lineGap) : 0)
  let cursorY = originY + Math.max(pad, (height - blockHeight) / 2)

  ctx.font = `700 ${codeSize}px Manrope, sans-serif`
  ctx.fillText(item.code, textX, cursorY, textWidth)
  cursorY += codeSize + lineGap

  ctx.font = `500 ${detailSize}px Manrope, sans-serif`
  for (const line of details) {
    ctx.fillText(line, textX, cursorY, textWidth)
    cursorY += detailSize + lineGap
  }

  ctx.restore()
}

export async function downloadLabelsPdf(
  items: LabelContent[],
  template: LabelTemplate,
  settings: LabelFieldSettings,
) {
  if (items.length === 0) throw new Error('Нет этикеток для сохранения.')
  await document.fonts.load(`700 ${Math.round(template.codeFontMm * PX_PER_MM)}px Manrope`)
  await document.fonts.ready

  const { jsPDF } = await import('jspdf')
  const orientation = pageOrientation(template.pageWidthMm, template.pageHeightMm)
  const doc = new jsPDF({
    unit: 'mm',
    format: [template.pageWidthMm, template.pageHeightMm],
    orientation,
  })

  const pages = chunkLabels(items, labelsPerPage(template))
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    if (pageIndex > 0) {
      doc.addPage([template.pageWidthMm, template.pageHeightMm], orientation)
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(template.pageWidthMm * PX_PER_MM)
    canvas.height = Math.round(template.pageHeightMm * PX_PER_MM)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Не удалось подготовить PDF.')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const pageItems = pages[pageIndex] ?? []
    for (let index = 0; index < pageItems.length; index += 1) {
      const item = pageItems[index]
      if (!item) continue
      const column = index % template.columns
      const row = Math.floor(index / template.columns)
      const x = (template.marginMm + column * (template.labelWidthMm + template.gapMm)) * PX_PER_MM
      const y = (template.marginMm + row * (template.labelHeightMm + template.gapMm)) * PX_PER_MM
      await drawLabel(ctx, item, template, settings, x, y)
    }

    doc.addImage(
      canvas.toDataURL('image/png'),
      'PNG',
      0,
      0,
      template.pageWidthMm,
      template.pageHeightMm,
    )
  }

  doc.save(`etiketki-${template.id}.pdf`)
}
