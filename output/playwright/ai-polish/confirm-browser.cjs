const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE, headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    const source = '我们在写技术文章的时候，经常会把很多信息一下子放在同一个段落里。内容可能是对的，但是读起来会有一点费劲。'
    const content = '## 让技术文章更好读\n\n' + Array.from({ length: 10 }, () => source).join('\n\n') + '\n\n先说明 **核心问题**，再介绍 [项目文档](https://example.org/docs)。\n\n```js\nconst preserved = 123;\n```'
    let calls = 0
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/api/v1/**', async route => {
      const req = route.request(), url = new URL(req.url())
      const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 200, message: 'success', data }) })
      if (url.pathname.endsWith('/auth/refresh')) return ok({ token: 'local-browser-fixture-token', userId: 12, username: 'polish_tester', nickname: '测试作者', role: 'USER' })
      if (url.pathname.endsWith('/users/me')) return ok({ id: 12, username: 'polish_tester', nickname: '测试作者', role: 'USER' })
      if (url.pathname.endsWith('/articles/ai-polish')) {
        calls++
        await new Promise(resolve => setTimeout(resolve, 450))
        return ok({ segments: req.postDataJSON().segments.map(segment => ({ id: segment.id, text: segment.text === '让技术文章更好读' ? '让表达更清楚' : segment.text.replaceAll(source, '技术文章应当聚焦重点，避免在同一段落堆积过多信息。即使内容准确，也需要清晰的表达，让读者更容易理解。') })) })
      }
      if (url.pathname === '/api/v1/articles/9001') return ok({ id: 9001, title: '从信息堆积到清晰表达', content, summary: '让技术文章更好读。', status: 'DRAFT', version: 0, authorId: 12, authorName: 'polish_tester', updatedAt: '2026-09-12T18:00:00', draftVisible: true })
      if (url.pathname.endsWith('/home')) return ok({ sections: [], stats: {} })
      if (url.pathname.endsWith('/categories') || url.pathname.endsWith('/articles/drafts')) return ok([])
      return ok({})
    })
    await page.goto('http://127.0.0.1:15173/editor/9001')
    const trigger = page.locator('.editor-ai-trigger:visible')
    await trigger.waitFor()
    await trigger.click()
    await page.locator('.editor-polish-bubble[aria-busy="false"] .editor-polish-prose').waitFor()
    await page.waitForTimeout(500)
    await trigger.hover()
    await page.waitForTimeout(220)
    const hovered = await page.locator('.editor-polish-bubble').boundingBox()
    await page.mouse.move(1350, 900)
    await page.waitForTimeout(220)
    const resting = await page.locator('.editor-polish-bubble').boundingBox()
    assert.ok(Math.abs(hovered.x - resting.x) < 0.1, `anchor drift: ${hovered.x} -> ${resting.x}`)
    const details = await page.locator('.editor-polish-bubble').evaluate(el => ({
      textOnly: el.textContent.trim() === el.querySelector('.editor-polish-prose').textContent.trim(),
      buttons: [...el.querySelectorAll('button')].map(button => ({ text: button.textContent.trim(), label: button.getAttribute('aria-label') })),
      scrollable: el.querySelector('.editor-polish-scroll').scrollHeight > el.querySelector('.editor-polish-scroll').clientHeight,
    }))
    assert.equal(details.textOnly, true)
    assert.equal(details.buttons.length, 2)
    assert.ok(details.buttons.every(button => !button.text))
    assert.equal(details.scrollable, true)
    await page.screenshot({ path: path.join(__dirname, 'desktop-light-final.png') })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.screenshot({ path: path.join(__dirname, 'desktop-dark-final.png') })
    await page.keyboard.press('Escape')
    await page.locator('.editor-polish-bubble').waitFor({ state: 'hidden' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    await trigger.click()
    await page.locator('.editor-polish-bubble[aria-busy="false"] .editor-polish-prose').waitFor()
    await page.waitForTimeout(500)
    const mobile = await page.locator('.editor-polish-bubble').boundingBox()
    assert.ok(mobile.x >= 16 && mobile.x + mobile.width <= 374)
    await page.screenshot({ path: path.join(__dirname, 'mobile-light-final.png') })
    assert.deepEqual(errors, [])
    const receiptPath = path.join(__dirname, 'browser-receipt.json')
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'))
    Object.assign(receipt, { stableAnchor: true, anchorPositions: { hover: hovered.x, rest: resting.x }, finalDetails: details, finalMobile: mobile, finalErrors: errors })
    await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2))
    console.log(JSON.stringify({ stableAnchor: true, details, mobile, calls, errors }))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
