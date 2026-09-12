import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const root = new URL('../../', import.meta.url)
const source = (path) => readFile(new URL(path, root), 'utf8')

test('docker nginx always proxies uploaded images before the generic asset matcher', async () => {
  const nginx = await source('deploy/docker/nginx.conf')

  assert.match(nginx, /location \^~ \/static\/uploads\//)
  assert.match(nginx, /proxy_pass http:\/\/gateway:8080/)
})

test('opening an existing editor article refreshes server-authoritative status', async () => {
  const editor = await source('src/features/article-editor/ui/ArticleEditorForm.vue')

  assert.match(editor, /editorStore\.loadArticleDetail\(workingArticleId\.value,\s*true\)/)
  const page = await source('src/pages/article/ArticleEditorPage.vue')
  assert.match(page, /currentStatus\.value === ARTICLE_STATUS\.RETURNED/)
  assert.match(page, /text: currentStatusLabel\.value \|\| '已退回'/)
})

test('confirmed review success is not converted into a cache-refresh failure', async () => {
  const actionBar = await source('src/features/review-action/ui/ReviewActionBar.vue')
  const refreshBlock = actionBar.match(/async function refreshReviewRelatedData[\s\S]*?\n}/)?.[0] ?? ''

  assert.doesNotMatch(refreshBlock, /queryKeys\.articleDetail/)
  assert.match(actionBar, /toast\.success\(/)
  assert.match(actionBar, /void refreshReviewRelatedData\(articleIdStr\)\.catch\(\(\) => undefined\)/)
})

test('review detail polling stops once the article leaves PENDING', async () => {
  const page = await source('src/pages/article/ArticleReviewPage.vue')

  assert.match(page, /article\.value\?\.status\.value === ARTICLE_STATUS\.PENDING/)
  assert.match(page, /:review-refresh-interval-ms="articleRefreshIntervalMs"/)
})
