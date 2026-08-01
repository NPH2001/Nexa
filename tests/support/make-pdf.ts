/**
 * Sinh một file PDF tối thiểu nhưng HỢP LỆ (có bảng xref đúng offset).
 *
 * Tự sinh thay vì commit một file nhị phân: fixture đọc được, sửa được, và không ai phải tin
 * một blob không rõ nguồn gốc trong repo.
 */
export function makeSimplePdf(pages: readonly string[]): Buffer {
  const objects: string[] = []
  const pageCount = pages.length
  // 1 = Catalog, 2 = Pages, 3 = Font, sau đó mỗi trang chiếm 2 object (Page + Contents).
  const firstPageObj = 4

  objects.push('<</Type/Catalog/Pages 2 0 R>>')

  const kids = pages.map((_, i) => `${String(firstPageObj + i * 2)} 0 R`).join(' ')
  objects.push(`<</Type/Pages/Kids[${kids}]/Count ${String(pageCount)}>>`)
  objects.push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>')

  pages.forEach((text, i) => {
    const contentsObj = firstPageObj + i * 2 + 1
    objects.push(
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]` +
        `/Resources<</Font<</F1 3 0 R>>>>/Contents ${String(contentsObj)} 0 R>>`,
    )
    const stream = `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`
    objects.push(`<</Length ${String(stream.length)}>>\nstream\n${stream}\nendstream`)
  })

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${String(i + 1)} 0 obj\n${obj}\nendobj\n`
  })

  const xrefStart = body.length
  let xref = `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, '0')} 00000 n \n`
  }
  const trailer =
    `trailer\n<</Size ${String(objects.length + 1)}/Root 1 0 R>>\n` +
    `startxref\n${String(xrefStart)}\n%%EOF\n`

  return Buffer.from(body + xref + trailer, 'latin1')
}

/** PDF text string: escape `\`, `(` và `)`. */
function escapePdfText(text: string): string {
  return text.replace(/([\\()])/g, '\\$1')
}
