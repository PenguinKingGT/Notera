/** Parse bounded, well-formed XML without fetching schemas, entities or external resources. */
import { SaxesParser } from 'saxes'

export const MAX_XML_BYTES = 8 * 1024 * 1024

/** User-facing exchange failure; rejected input never becomes a replacement document. */
export class ExchangeError extends Error {
  /** Explain the unsupported feature or unsafe input in the file-operation UI. */
  constructor(message: string) {
    super(message)
    this.name = 'ExchangeError'
  }
}

/** Minimal element tree; musical interpretation lives in the independent importer. */
export interface XmlElement {
  name: string
  attributes: Record<string, string>
  children: XmlElement[]
  text: string
}

/** Read XML with explicit byte, depth and element budgets; standard external DTD declarations are inert. */
export function parseXml(text: string): XmlElement {
  if (new globalThis.TextEncoder().encode(text).length > MAX_XML_BYTES) {
    throw new ExchangeError('MusicXML 超过 8 MiB 的读取限制。')
  }
  const parser = new SaxesParser({ xmlns: true })
  const stack: XmlElement[] = []
  let root: XmlElement | undefined
  let count = 0
  parser.on('doctype', (doctype) => {
    // Conventional MusicXML external DTDs are declarations only. Internal subsets could define hostile entities.
    if (doctype.includes('[')) {
      throw new ExchangeError('不接受含内部 DTD 或自定义实体的 XML。')
    }
  })
  parser.on('opentag', (tag) => {
    if (++count > 150_000 || stack.length >= 64) {
      throw new ExchangeError('XML 的元素数量或嵌套深度超过限制。')
    }
    if (tag.uri && tag.uri !== 'http://www.musicxml.org/ns/musicxml') {
      throw new ExchangeError('XML 包含尚不支持的元素命名空间。')
    }
    const element: XmlElement = {
      name: tag.local,
      attributes: {},
      children: [],
      text: '',
    }
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.local === 'href') {
        throw new ExchangeError('不接受包含外部资源引用的 MusicXML。')
      }
      element.attributes[attribute.name] = attribute.value
    }
    const parent = stack.at(-1)
    if (parent) {
      parent.children.push(element)
    } else {
      root = element
    }
    stack.push(element)
  })
  parser.on('text', (value) => {
    const element = stack.at(-1)
    if (element) {
      element.text += value
    }
  })
  parser.on('cdata', (value) => {
    const element = stack.at(-1)
    if (element) {
      element.text += value
    }
  })
  parser.on('closetag', () => stack.pop())
  try {
    parser.write(text).close()
  } catch (error) {
    if (error instanceof ExchangeError) {
      throw error
    }
    throw new ExchangeError('XML 格式损坏，无法读取。')
  }
  if (!root) {
    throw new ExchangeError('XML 缺少根元素。')
  }
  return root
}

/** Select direct children only, avoiding accidental matches inside another musical construct. */
export function children(node: XmlElement, name: string): XmlElement[] {
  return node.children.filter((child) => child.name === name)
}

/** Read one optional child; duplicates are ambiguous and rejected. */
export function child(node: XmlElement, name: string): XmlElement | undefined {
  const matches = children(node, name)
  if (matches.length > 1) {
    throw new ExchangeError(`MusicXML 中的 ${name} 不应重复。`)
  }
  return matches[0]
}

/** Return trimmed scalar content without interpreting escaped XML as markup. */
export function value(node: XmlElement, name: string, fallback = ''): string {
  return child(node, name)?.text.trim() ?? fallback
}

/** Parse bounded integers without treating empty strings or decimals as valid music time. */
export function integer(text: string, min: number, max: number): number {
  const number = Number(text)
  if (
    !/^-?\d+$/.test(text) ||
    !Number.isSafeInteger(number) ||
    number < min ||
    number > max
  ) {
    throw new ExchangeError(`MusicXML 数值超出支持范围：${text.slice(0, 40)}。`)
  }
  return number
}

/** Escape all XML delimiters, including quotes used by attributes. */
export function escapeXml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character]!,
  )
}
