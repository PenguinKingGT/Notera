/** Narrow declarations for the installed Verovio 6.3 ESM API consumed by the engraving worker. */
declare module 'verovio/wasm' {
  /** Initialize the precompiled, embedded WASM module. */
  export default function createVerovioModule(): Promise<unknown>
}
declare module 'verovio/esm' {
  /** Whole-score engraving toolkit; editor commands remain in the independent musical core. */
  export class VerovioToolkit {
    /** Bind a ready WASM module. */
    constructor(module: unknown)
    /** Configure dimensions and engraving behavior. */
    setOptions(options: Record<string, unknown>): void
    /** Parse MEI, reporting whether loading succeeded. */
    loadData(data: string): number
    /** Read the parsed MEI for independent MusicXML interoperability verification. */
    getMEI(options: Record<string, unknown>): string
    /** Return the calculated page count. */
    getPageCount(): number
    /** Draw one page as self-contained SVG. */
    renderToSVG(page: number): string
    /** Release native WASM state. */
    destroy(): void
  }
}
