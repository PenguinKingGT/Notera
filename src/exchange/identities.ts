/** Preserve native entity identities through optional MusicXML metadata, never using metadata as musical content. */
import type { Fraction, WrittenPitch } from '../core'
import type { XmlElement } from './xml'
import { children, child, ExchangeError } from './xml'

export const IDENTITY_FIELD = 'notera-identities-v1'
export type IdentityMap = Record<string, string>

/** Key an event by measure index, MusicXML voice and exact onset; spacing and file order do not affect identity. */
export function eventKey(
  measure: number,
  voice: string,
  onset: Fraction,
): string {
  return `event:${measure}:${voice}:${onset.numerator}/${onset.denominator}`
}

/** Retain independently editable chord-note IDs by written pitch within their event. */
export function noteKey(event: string, pitch: WrittenPitch): string {
  return `${event}:${pitch.step}:${pitch.alter}:${pitch.octave}`
}

/** Read a bounded string dictionary; hostile or malformed metadata cannot bypass core validation. */
export function readIdentities(root: XmlElement): IdentityMap {
  const identification = child(root, 'identification')
  const miscellaneous = identification && child(identification, 'miscellaneous')
  const field =
    miscellaneous &&
    children(miscellaneous, 'miscellaneous-field').find(
      (node) => node.attributes.name === IDENTITY_FIELD,
    )
  if (!field) {
    return {}
  }
  try {
    const map: unknown = JSON.parse(field.text)
    if (
      !map ||
      typeof map !== 'object' ||
      Array.isArray(map) ||
      Object.keys(map).length > 30_000
    ) {
      throw new Error('Invalid identity map')
    }
    for (const [key, id] of Object.entries(map)) {
      if (
        key.length > 300 ||
        typeof id !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)
      ) {
        throw new Error('Invalid identity')
      }
    }
    return map as IdentityMap
  } catch {
    throw new ExchangeError('Notera 身份元数据损坏。请从来源软件重新导出。')
  }
}

/** Restore only known own properties; inherited object keys never become native IDs. */
export function identity(
  map: IdentityMap,
  key: string,
  fallback: string,
): string {
  return Object.hasOwn(map, key) ? map[key] : fallback
}
