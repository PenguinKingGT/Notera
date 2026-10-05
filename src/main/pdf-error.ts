/** Keep actionable PDF failures independent of Electron so file-service tests run in Node. */
export class PdfExportError extends Error {}
