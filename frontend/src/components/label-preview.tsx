import { UnitQr } from '@/components/unit-qr'
import {
  chunkLabels,
  labelDetailLines,
  labelsPerPage,
  type LabelContent,
  type LabelFieldSettings,
  type LabelTemplate,
} from '@/lib/label-templates'

function pageCss(template: LabelTemplate): string {
  return `
    @media print {
      @page { size: ${template.pageWidthMm}mm ${template.pageHeightMm}mm; margin: 0; }
      html, body, #root { background: #fff !important; }
      .label-page {
        box-shadow: none !important;
        break-after: page;
        page-break-after: always;
      }
      .label-page:last-child {
        break-after: auto;
        page-break-after: auto;
      }
    }
  `
}

function LabelFace({
  item,
  template,
  settings,
}: {
  item: LabelContent
  template: LabelTemplate
  settings: LabelFieldSettings
}) {
  const lines = labelDetailLines(item, settings)
  return (
    <article
      className="box-border flex h-full w-full items-center overflow-hidden bg-white text-black"
      style={{
        padding: `${template.paddingMm}mm`,
        gap: `${template.paddingMm * 0.55}mm`,
        outline: template.columns > 1 ? '0.15mm dashed #b5b5b5' : undefined,
      }}
    >
      <UnitQr code={item.code} millimetres={template.qrMm} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p
          className="font-mono leading-none font-bold tracking-tight"
          style={{ fontSize: `${template.codeFontMm}mm` }}
        >
          {item.code}
        </p>
        {lines.map((line, index) => (
          <p
            key={`${item.code}-${index}`}
            className="leading-tight"
            style={{
              marginTop: index === 0 ? `${template.paddingMm * 0.35}mm` : '0.3mm',
              fontSize: `${template.textFontMm}mm`,
            }}
          >
            {line}
          </p>
        ))}
      </div>
    </article>
  )
}

export function LabelPreview({
  items,
  template,
  settings,
}: {
  items: LabelContent[]
  template: LabelTemplate
  settings: LabelFieldSettings
}) {
  const pages = chunkLabels(items, labelsPerPage(template))
  return (
    <div className="label-print-root flex flex-col items-start gap-4">
      <style>{pageCss(template)}</style>
      {pages.map((page, pageIndex) => (
        <section
          key={`${template.id}-${pageIndex}`}
          className="label-page bg-white shadow-sm"
          style={{
            width: `${template.pageWidthMm}mm`,
            height: `${template.pageHeightMm}mm`,
            display: 'grid',
            gridTemplateColumns: `repeat(${template.columns}, ${template.labelWidthMm}mm)`,
            gridTemplateRows: `repeat(${template.rows}, ${template.labelHeightMm}mm)`,
            columnGap: `${template.gapMm}mm`,
            rowGap: `${template.gapMm}mm`,
            padding: `${template.marginMm}mm`,
            boxSizing: 'border-box',
          }}
        >
          {page.map((item) => (
            <LabelFace
              key={`${item.code}-${pageIndex}`}
              item={item}
              template={template}
              settings={settings}
            />
          ))}
        </section>
      ))}
    </div>
  )
}
