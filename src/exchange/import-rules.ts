/** Keep supported note durations and loss/rejection policy separate from the measure cursor interpreter. */
import { compare, durationTime } from '../core'
import type { Fraction, NotatedDuration } from '../core'
import { NOTE_TYPES } from './export'
import { child, children, ExchangeError, integer, value } from './xml'
import type { XmlElement } from './xml'

const UNSUPPORTED = new Set([
  'grace',
  'cue',
  'unpitched',
  'transpose',
  'ending',
  'segno',
  'coda',
  'octave-shift',
  'measure-style',
  'staff-details',
  'staff-tuning',
  'part-link',
  'link',
  'image',
  'credit-image',
])
const PRESENTATION = new Set([
  'defaults',
  'print',
  'credit',
  'beam',
  'stem',
  'accidental',
  'tuplet',
])
export const OMITTED_NOTATION = new Set([
  'lyric',
  'harmony',
  'figured-bass',
  'articulations',
  'ornaments',
  'technical',
  'fermata',
  'arpeggiate',
  'non-arpeggiate',
  'wedge',
  'words',
  'rehearsal',
  'metronome',
  'dashes',
  'bracket',
  'other-direction',
  'other-notation',
  'glissando',
  'slide',
  'trill-mark',
  'tremolo',
  'bend',
])

/** Read written duration and require its exact rational time to agree with the sounding duration. */
export function readDuration(
  node: XmlElement,
  time: Fraction,
): NotatedDuration {
  const dots = children(node, 'dot').length
  if (dots > 3) {
    throw new ExchangeError('首版最多支持三个附点。')
  }
  const modification = child(node, 'time-modification')
  const tuplet = modification
    ? {
        actual: integer(value(modification, 'actual-notes'), 2, 32),
        normal: integer(value(modification, 'normal-notes'), 1, 32),
      }
    : undefined
  if (
    modification &&
    (child(modification, 'normal-type') ||
      children(modification, 'normal-dot').length)
  ) {
    const normalType = value(modification, 'normal-type', value(node, 'type'))
    if (
      normalType !== value(node, 'type') ||
      children(modification, 'normal-dot').length !== dots
    ) {
      throw new ExchangeError('首版尚不支持不同基准音值的连音。')
    }
  }
  const type = value(node, 'type')
  const denominators = Object.entries(NOTE_TYPES)
    .filter(([, name]) => !type || name === type)
    .map(([denominator]) => Number(denominator))
  for (const denominator of denominators) {
    const candidates = type || dots ? [dots] : [0, 1, 2, 3]
    for (const count of candidates) {
      const duration = {
        denominator,
        dots: count,
        ...(tuplet ? { tuplet } : {}),
      } as NotatedDuration
      if (compare(durationTime(duration), time) === 0) {
        return duration
      }
    }
  }
  throw new ExchangeError(
    '音符的记谱时值与 duration 不一致，或超出首版支持范围。',
  )
}

/** Reject structural musical features that cannot be represented; report omitted notation before document replacement. */
export function inspect(node: XmlElement, warnings: Set<string>): void {
  if (
    (node.name === 'tie' || node.name === 'tied') &&
    node.attributes['time-only']
  ) {
    throw new ExchangeError('首版尚不支持仅在指定反复次数生效的延音线。')
  }
  if (
    node.name === 'note' &&
    (node.attributes.attack || node.attributes.release)
  ) {
    warnings.add('未保留音符 attack/release 播放时间微调。')
  }
  if (UNSUPPORTED.has(node.name)) {
    throw new ExchangeError(`首版尚不支持 ${node.name}，当前乐谱已保留。`)
  }
  if (OMITTED_NOTATION.has(node.name)) {
    warnings.add(`未保留 ${node.name} 记号。`)
  }
  if (PRESENTATION.has(node.name)) {
    warnings.add('原文件的版式、符干、符杠和连音分组将由 Notera 重新排版。')
  }
  if (node.name === 'sound') {
    const navigation = [
      'dacapo',
      'dalsegno',
      'tocoda',
      'fine',
      'forward-repeat',
    ]
    if (navigation.some((name) => Object.hasOwn(node.attributes, name))) {
      throw new ExchangeError('首版尚不支持跳转式反复记号。')
    }
    warnings.add('未保留来源文件的速度和播放参数。')
  }
  if (
    node.attributes['print-object'] === 'no' ||
    node.attributes['print-spacing'] === 'no'
  ) {
    warnings.add('隐藏或无间距的记号将作为普通音乐内容重新排版。')
  }
  const knownChildren: Record<string, readonly string[]> = {
    note: [
      'chord',
      'pitch',
      'rest',
      'duration',
      'tie',
      'voice',
      'type',
      'dot',
      'accidental',
      'time-modification',
      'stem',
      'notehead',
      'notehead-text',
      'staff',
      'beam',
      'notations',
      'lyric',
      'instrument',
      'play',
      'listen',
      'footnote',
      'level',
    ],
    pitch: ['step', 'alter', 'octave'],
    'time-modification': [
      'actual-notes',
      'normal-notes',
      'normal-type',
      'normal-dot',
    ],
  }
  for (const nested of node.children) {
    if (
      knownChildren[node.name] &&
      !knownChildren[node.name].includes(nested.name)
    ) {
      if (node.name === 'pitch' || node.name === 'time-modification') {
        throw new ExchangeError(`首版尚不支持 ${nested.name} 音高或时值内容。`)
      }
      warnings.add(`未保留音符中的 ${nested.name} 内容。`)
    }
    if (
      [
        'creator',
        'rights',
        'source',
        'relation',
        'notehead',
        'notehead-text',
        'instrument',
        'play',
        'listen',
      ].includes(nested.name)
    ) {
      warnings.add(`未保留 ${nested.name} 元数据或演奏外观。`)
    }
    inspect(nested, warnings)
  }
  if (warnings.size > 200) {
    throw new ExchangeError('不支持的 MusicXML 内容种类超过限制。')
  }
}
