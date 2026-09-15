import type { JSONContent } from '@tiptap/core'
import type { ArticlePolishResponse, ArticlePolishSegment } from '@/shared/api/modules/article-polish'

export const POLISH_MAX_CHARS = 12_000
export const POLISH_MAX_SEGMENTS = 200

export interface PolishSnapshot {
  document: JSONContent
  signature: string
  segments: ArticlePolishSegment[]
}

export function createPolishSnapshot(document: JSONContent): PolishSnapshot {
  const signature = JSON.stringify(document)
  const copy: JSONContent = JSON.parse(signature)
  const segments: ArticlePolishSegment[] = []
  function visit(node: JSONContent, path: number[]) {
    if (node.type === 'codeBlock' || node.type === 'image') return
    if (node.type === 'text' && node.text?.trim() && !node.marks?.some(mark => mark.type === 'code' || mark.type === 'link')) {
      segments.push({ id: path.join('.'), text: node.text })
    }
    node.content?.forEach((child, index) => visit(child, [...path, index]))
  }
  visit(copy, [])
  if (!segments.length) throw new Error('请先输入需要润色的正文')
  if (segments.length > POLISH_MAX_SEGMENTS || segments.reduce((sum, segment) => sum + segment.text.length, 0) > POLISH_MAX_CHARS) {
    throw new Error('单次润色最多支持 12000 字符、200 个文本片段，请缩短正文后重试')
  }
  return { document: copy, signature, segments }
}

export function canApplyPolish(snapshot: PolishSnapshot, current: JSONContent): boolean {
  return snapshot.signature === JSON.stringify(current)
}

/** Replace only allowlisted text leaves. AI cannot add nodes, marks, URLs or image attributes. */
export function buildPolishedDocument(snapshot: PolishSnapshot, response: ArticlePolishResponse): JSONContent {
  const invalid = () => new Error('AI 返回的润色内容不完整，请重新生成')
  if (!response || !Array.isArray(response.segments) || response.segments.length !== snapshot.segments.length) throw invalid()
  const expected = new Map(snapshot.segments.map(segment => [segment.id, segment.text]))
  const replacements = new Map<string, string>()
  let chars = 0
  for (const segment of response.segments) {
    if (!segment || typeof segment.id !== 'string' || !expected.has(segment.id) || replacements.has(segment.id)
      || typeof segment.text !== 'string' || !segment.text.trim() || segment.text.length > 24_000) throw invalid()
    chars += segment.text.length
    const source = expected.get(segment.id)!
    const leading = source.match(/^\s*/u)?.[0] ?? ''
    const trailing = source.match(/\s*$/u)?.[0] ?? ''
    replacements.set(segment.id, leading + segment.text.trim() + trailing)
  }
  if (chars > 36_000) throw invalid()
  const document: JSONContent = JSON.parse(snapshot.signature)
  function replace(node: JSONContent, path: number[]) {
    const replacement = replacements.get(path.join('.'))
    if (node.type === 'text' && replacement !== undefined) node.text = replacement
    node.content?.forEach((child, index) => replace(child, [...path, index]))
  }
  replace(document, [])
  return document
}

export interface PolishAnchorRect { left: number; top: number; right: number; bottom: number; width: number; height: number }

/** Viewport-bounded popover with a transform origin pointing at its real trigger. */
export function positionPolishBubble(anchor: PolishAnchorRect, viewport: { width: number; height: number; left?: number; top?: number }) {
  const margin = 16, gap = 14
  const minX = (viewport.left ?? 0) + margin, minY = (viewport.top ?? 0) + margin
  const maxX = (viewport.left ?? 0) + viewport.width - margin
  const maxY = (viewport.top ?? 0) + viewport.height - margin
  const width = Math.min(580, Math.max(0, viewport.width - margin * 2))
  const height = Math.min(520, Math.max(0, viewport.height - margin * 2))
  const preferRight = maxX - anchor.right >= anchor.left - minX
  const side = preferRight ? 'right' : 'left'
  const idealLeft = preferRight ? anchor.right + gap : anchor.left - gap - width
  const left = Math.max(minX, Math.min(idealLeft, maxX - width))
  const centerY = anchor.top + anchor.height / 2
  const top = Math.max(minY, Math.min(centerY - height / 2, maxY - height))
  const originX = anchor.left + anchor.width / 2 - left
  const originY = centerY - top
  const tailVisible = preferRight ? left >= anchor.right : left + width <= anchor.left
  return { left, top, width, height, originX, originY, side, tailVisible, tailY: Math.max(24, Math.min(originY, height - 24)) }
}
