/** Read effective piano attributes only at measure boundaries, rejecting contexts the native model cannot express. */
import type { Measure } from '../core'
import { child, children, ExchangeError, integer, value } from './xml'
import type { XmlElement } from './xml'

/** Context carries forward when a MusicXML measure omits unchanged attributes. */
export interface MusicContext {
  divisions: number
  timeSignature: Measure['timeSignature'] | null
  keySignature: Measure['keySignature']
  staves: number
}

/** Return a fresh effective context; input state is not changed if any attribute is rejected. */
export function readAttributes(
  element: XmlElement,
  previous: MusicContext,
  warnings: Set<string>,
): MusicContext {
  const context = { ...previous }
  const division = value(element, 'divisions')
  if (division) {
    context.divisions = integer(division, 1, 1_000_000)
  }
  const meter = child(element, 'time')
  if (meter) {
    if (
      meter.attributes.number ||
      child(meter, 'senza-misura') ||
      meter.attributes.symbol === 'single-number'
    ) {
      throw new ExchangeError('首版尚不支持独立谱表拍号或自由拍。')
    }
    context.timeSignature = {
      beats: integer(value(meter, 'beats'), 1, 32),
      beatType: integer(
        value(meter, 'beat-type'),
        1,
        32,
      ) as Measure['timeSignature']['beatType'],
    }
  }
  const key = child(element, 'key')
  if (key) {
    if (key.attributes.number || children(key, 'key-step').length) {
      throw new ExchangeError('首版尚不支持独立谱表调号或自定义调号。')
    }
    context.keySignature = { fifths: integer(value(key, 'fifths'), -7, 7) }
    if (child(key, 'mode')) {
      warnings.add('保留调号升降数量，暂不记录大小调等调式信息。')
    }
  }
  const count = value(element, 'staves')
  if (count) {
    context.staves = integer(count, 2, 2)
  }
  for (const clef of children(element, 'clef')) {
    const number = integer(clef.attributes.number ?? '1', 1, 2)
    if (
      value(clef, 'sign') !== (number === 1 ? 'G' : 'F') ||
      value(clef, 'line') !== (number === 1 ? '2' : '4') ||
      value(clef, 'clef-octave-change', '0') !== '0'
    ) {
      throw new ExchangeError('首版仅支持固定高音、低音谱号。')
    }
  }
  const known = new Set(['divisions', 'key', 'time', 'staves', 'clef'])
  for (const nested of element.children) {
    if (!known.has(nested.name)) {
      throw new ExchangeError(`首版尚不支持 ${nested.name} 乐谱属性。`)
    }
  }
  return context
}
