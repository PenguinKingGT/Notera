/** Share physical A4 dimensions between engraving and printing, reserving space for the complete musical title. */
export function pdfLayout(title: string): {
  headerMm: number
  musicMm: number
  titlePt: number
} {
  const length = [...title].length
  const headerMm =
    length <= 30
      ? 12
      : length <= 120
        ? 20
        : Math.max(20, Math.ceil(length / 60) * 4)
  return {
    headerMm,
    musicMm: 297 - 32 - 6 - headerMm,
    titlePt: length <= 30 ? 16 : length <= 120 ? 12 : 8,
  }
}
