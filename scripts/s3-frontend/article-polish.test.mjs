import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
async function load(path, deps = {}) {
  const exports = {}
  const code = ts.transpileModule(await read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { exports, require: name => { if (!(name in deps)) throw Error(name); return deps[name] } })
  return exports
}
const model = await load('src/features/article-editor/model/editor-polish.ts')
const plain = value => JSON.parse(JSON.stringify(value))
const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const document = () => ({ type: 'doc', content: [
  { type: 'heading', attrs: { level: 2 }, content: [text('标题')] },
  { type: 'paragraph', attrs: { textAlign: 'center' }, content: [text(' 原文 '), text('加粗', [{ type: 'bold' }]), text('链接', [{ type: 'link', attrs: { href: 'https://example.org' } }]), text('inline()', [{ type: 'code' }])] },
  { type: 'codeBlock', attrs: { language: 'js' }, content: [text('const important = 123')] },
  { type: 'image', attrs: { src: '/static/existing.webp', width: 300, alt: '原图片' } },
  { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1 }, content: [{ type: 'paragraph', content: [text('表格原文')] }] }] }] },
] })

test('snapshot extracts only text leaves and protects code, links, images, marks and block structure', () => {
  const source = document(), before = JSON.stringify(source), snapshot = model.createPolishSnapshot(source)
  assert.deepEqual(plain(snapshot.segments).map(segment => segment.text), ['标题', ' 原文 ', '加粗', '表格原文'])
  const output = { segments: snapshot.segments.map(segment => ({ id: segment.id, text: '改善表达' })).reverse() }
  const result = model.buildPolishedDocument(snapshot, output)
  assert.equal(JSON.stringify(source), before)
  assert.equal(result.content[1].content[0].text, ' 改善表达 ')
  assert.deepEqual(plain(result.content[1].content[1].marks), [{ type: 'bold' }])
  assert.deepEqual(plain(result.content[1].content.slice(2)), source.content[1].content.slice(2))
  assert.deepEqual(plain(result.content.slice(2, 4)), source.content.slice(2, 4))
  assert.equal(result.content[4].content[0].content[0].content[0].content[0].text, '改善表达')
  assert.equal(result.content[1].attrs.textAlign, 'center')
})
test('stale document detection rejects typing, formatting and changed image attributes', () => {
  const source = document(), snapshot = model.createPolishSnapshot(source)
  assert.equal(model.canApplyPolish(snapshot, source), true)
  for (const change of [doc => doc.content[0].content[0].text += '编辑', doc => doc.content[1].attrs.textAlign = 'right', doc => doc.content[3].attrs.width = 600]) {
    const changed = structuredClone(source); change(changed)
    assert.equal(model.canApplyPolish(snapshot, changed), false)
  }
})
test('malformed, missing, duplicated, oversized and unknown provider segments cannot be applied', () => {
  const snapshot = model.createPolishSnapshot(document())
  const good = snapshot.segments.map(segment => ({ ...segment, text: '新内容' }))
  for (const result of [null, {}, { segments: [] }, { segments: [...good.slice(1), good[1]] },
    { segments: good.map((s, i) => i ? s : { id: '__proto__', text: 'x' }) },
    { segments: good.map((s, i) => i ? s : { ...s, text: 123 }) },
    { segments: good.map((s, i) => i ? s : { ...s, text: ' ' }) },
    { segments: good.map((s, i) => i ? s : { ...s, text: 'x'.repeat(24001) }) }]) {
    assert.throws(() => model.buildPolishedDocument(snapshot, result), /不完整/)
  }
})
test('AI HTML remains literal text rather than creating nodes or URLs', () => {
  const snapshot = model.createPolishSnapshot({ type: 'doc', content: [{ type: 'paragraph', content: [text('原文')] }] })
  const injected = '<img src=x onerror=alert(1)><script>alert(1)</script>'
  const result = model.buildPolishedDocument(snapshot, { segments: [{ id: '0.0', text: injected }] })
  assert.deepEqual(plain(result), { type: 'doc', content: [{ type: 'paragraph', content: [text(injected)] }] })
})
test('empty/protected-only and oversized documents are rejected before any request', () => {
  for (const content of [[], [{ type: 'codeBlock', content: [text('code')] }], [{ type: 'paragraph', content: [text('x'.repeat(12001))] }], Array.from({ length: 201 }, () => ({ type: 'paragraph', content: [text('x')] }))]) {
    assert.throws(() => model.createPolishSnapshot({ type: 'doc', content }))
  }
})
test('bubble bounds stay in desktop/mobile/visual viewport and origin points back to trigger', () => {
  for (const width of [320, 390, 768, 1440]) for (const height of [300, 800]) for (const anchorX of [10, width - 48]) {
    const anchor = { left: anchorX, right: anchorX + 34, top: 180, bottom: 214, width: 34, height: 34 }
    const p = model.positionPolishBubble(anchor, { width, height })
    assert.ok(p.left >= 16 && p.left + p.width <= width - 16)
    assert.ok(p.top >= 16 && p.top + p.height <= height - 16)
    assert.equal(p.left + p.originX, anchor.left + 17)
    assert.equal(p.top + p.originY, 197)
  }
})
test('API mutation is abortable with explicit timeout and no automatic retry', async () => {
  const calls = []
  const api = await load('src/shared/api/modules/article-polish.ts', { '../request': { default: { post: (...args) => { calls.push(args); return Promise.resolve({ segments: [] }) } } } })
  const controller = new AbortController(), payload = { segments: [{ id: '0.0', text: '正文' }] }
  await api.polishArticle(payload, controller.signal)
  assert.equal(calls[0][0], '/articles/ai-polish')
  assert.equal(calls[0][1], payload)
  assert.equal(calls[0][2].signal, controller.signal)
  assert.equal(calls[0][2].timeout, 100000)
  assert.match(await read('src/shared/api/queries/article-polish.ts'), /retry: false/)
})
test('UI contract is icon-only, scrollable, outside-dismissed and reduced-motion aware', async () => {
  const source = await read('src/features/article-editor/ui/EditorAiPolish.vue')
  const bubbleTemplate = source.slice(source.indexOf('<Teleport'), source.indexOf('</Teleport>'))
  assert.equal((bubbleTemplate.match(/<button /g) ?? []).length, 2)
  assert.match(bubbleTemplate, /aria-label="确认应用"/)
  assert.match(bubbleTemplate, /重新生成/)
  assert.match(source, /event.composedPath\(\)/)
  assert.match(source, /controller\?\.abort\(\)/)
  assert.match(source, /requestId !== generation/)
  assert.match(source, /closeHistory/)
  assert.match(source, /prefers-reduced-motion:reduce/)
  assert.match(source, /overflow:auto/)
  assert.match(source, /transform-origin:var\(--polish-origin-x\)/)
  assert.match(source, /querySelector\('\.editor-ai-trigger-icon'\)/)
  assert.match(source, /editor-ai-trigger:not\(\.is-open\):hover/)
})
