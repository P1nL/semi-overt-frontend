import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../../', import.meta.url)
const source = async (path) => readFile(new URL(path, root), 'utf8')

class BusinessError extends Error {
  constructor(message, options = {}) { super(message); Object.assign(this, options) }
}

async function load(path, deps) {
  const exports = {}
  const code = ts.transpileModule(await source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { exports, require: (name) => { if (!(name in deps)) throw Error(name); return deps[name] }, Date, Number, String, Object, Error })
  return exports
}

test('article detail accepts only missing or nonnegative safe-integer version and carries submissionId', async () => {
  const contract = await load('src/shared/api/contract.ts', {
    '@/shared/types/api': { ApiBusinessError: BusinessError },
    '@/shared/utils/dateTime': { normalizeBackendDateTime: (value) => value ?? null },
  })
  const adapters = await load('src/shared/api/adapters.ts', {
    '@/shared/types/api': {},
    '@/shared/utils/asset': { resolveAssetUrl: (value) => value ?? null },
    '@/shared/utils/dateTime': { normalizeBackendDateTime: (value) => value ?? null },
    './contract': contract,
  })
  const base = { id: 1, title: 't', content: 'c', authorId: 2, authorName: 'u', status: 'DRAFT' }
  assert.equal(adapters.normalizeArticleDetailDto({ ...base }).version, undefined)
  const valid = adapters.normalizeArticleDetailDto({ ...base, version: 0, submissionId: ' sub-1 ' })
  assert.equal(valid.version, 0)
  assert.equal(valid.submissionId, 'sub-1')
  for (const version of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, '0', '']) {
    assert.throws(() => adapters.normalizeArticleDetailDto({ ...base, version }), /version/)
  }
})

test('editor payload sends version and saved VM advances only from server response', async () => {
  const mapper = await load('src/features/article-editor/model/editor.mapper.ts', {
    '@/shared/constants/article': { ARTICLE_DURATION_CATEGORY: { QUICK: 'QUICK' }, ARTICLE_SUMMARY_MAX_LENGTH: 200, ARTICLE_TITLE_MAX_LENGTH: 100 },
    '@/shared/utils/article': { calcWordCount: () => 12, calcReadMinutes: () => 1, resolveDurationCategory: () => 'QUICK' },
    '@/entities/article/model/article.mapper': { mapArticleDetailDtoToVm: (value) => ({ ...value, version: value.version ?? null, submissionId: value.submissionId ?? null }) },
  })
  const form = { title: ' t ', summary: '', content: 'body', coverUrl: '', coverColor: '', wordCount: 12, readMinutes: 1, durationCategory: 'QUICK' }
  assert.equal(mapper.mapEditorFormToDraftPayload(form, 4).version, 4)
  assert.equal('version' in mapper.mapEditorFormToDraftPayload(form, null), false)
  const current = { id: 1, version: 4, submissionId: 'sub-1', author: { id: 2, username: 'u', displayName: 'U', avatarUrl: null }, assignedAdminId: null, latestReviewReason: null, submitCount: 1, lastSubmittedAtRaw: null }
  const saved = mapper.mapSavedEditorFormToArticleDetailVm(current, form, { savedAt: '2026-09-10T08:00:00Z', version: 5, wordCount: 12, readMinutes: 1, durationCategory: 'QUICK', status: 'DRAFT', draftVisible: true })
  assert.equal(saved.version, 5)
  assert.equal(saved.submissionId, 'sub-1')
})

test('save response requires authoritative updatedAt and version for versioned request', async () => {
  let response
  const request = { put: async () => response, post: async () => response, get: async () => [], delete: async () => null }
  const contract = await load('src/shared/api/contract.ts', {
    '@/shared/types/api': { ApiBusinessError: BusinessError },
    '@/shared/utils/dateTime': { normalizeBackendDateTime: (value) => value ?? null },
  })
  const article = await load('src/shared/api/modules/article.ts', {
    '../request': { default: request },
    '../adapters': { normalizeArticleDetailDto: (value) => value },
    '@/shared/constants/article': { ARTICLE_STATUS: { DRAFT: 'DRAFT', PENDING: 'PENDING', RETURNED: 'RETURNED', REJECTED: 'REJECTED' } },
    '@/shared/utils/dateTime': { normalizeBackendDateTime: (value) => value ?? null },
    '../contract': contract,
    '@/shared/types/api': { ApiBusinessError: BusinessError },
  })
  response = { version: 5, updatedAt: '2026-09-10T08:00:00Z', wordCount: 12, readMinutes: 1, durationCategory: 'QUICK', status: 'DRAFT' }
  const saved = await article.saveDraft(1, { title: 't', version: 4 })
  assert.equal(saved.savedAt, '2026-09-10T08:00:00Z')
  assert.equal(saved.version, 5)
  response = { ...response, version: undefined }
  await assert.rejects(article.saveDraft(1, { title: 't', version: 4 }), /version/)
  response = { ...response, version: 5, updatedAt: null }
  await assert.rejects(article.saveDraft(1, { title: 't', version: 4 }), /updatedAt/)
  response = { ...response, version: -1, updatedAt: '2026-09-10T08:00:00Z' }
  await assert.rejects(article.saveDraft(1, { title: 't', version: 4 }), /version/)
})

test('cancel response version becomes the baseline for immediate resubmit', async () => {
  let response
  const request = { put: async () => response, post: async () => response, get: async () => [], delete: async () => null }
  const contract = await load('src/shared/api/contract.ts', {
    '@/shared/types/api': { ApiBusinessError: BusinessError },
    '@/shared/utils/dateTime': { normalizeBackendDateTime: (value) => value ?? null },
  })
  const article = await load('src/shared/api/modules/article.ts', {
    '../request': { default: request },
    '../adapters': { normalizeArticleDetailDto: (value) => value },
    '@/shared/constants/article': { ARTICLE_STATUS: { DRAFT: 'DRAFT', PENDING: 'PENDING', RETURNED: 'RETURNED', REJECTED: 'REJECTED' } },
    '@/shared/utils/dateTime': { normalizeBackendDateTime: (value) => value ?? null },
    '../contract': contract,
    '@/shared/types/api': { ApiBusinessError: BusinessError },
  })

  response = { status: 'PENDING', submitCount: 2, submissionId: 'submission-2', version: 6, lastSubmittedAt: '2026-09-10T08:00:00Z', updatedAt: '2026-09-10T08:00:00Z' }
  const submitted = await article.submitArticle(1, { expectedVersion: 5, requireSubmissionId: true })
  assert.equal(submitted.version, 6)
  assert.equal(submitted.submissionId, 'submission-2')

  response = { status: 'DRAFT', submissionId: 'submission-2', version: 7, updatedAt: '2026-09-10T08:01:00Z' }
  const cancelled = await article.cancelReview(1, { expectedVersion: submitted.version, expectedSubmissionId: submitted.submissionId })
  assert.equal(cancelled.version, 7)
  assert.equal(cancelled.submissionId, 'submission-2')

  response = { status: 'PENDING', submitCount: 3, submissionId: 'submission-3', version: 8, lastSubmittedAt: '2026-09-10T08:02:00Z', updatedAt: '2026-09-10T08:02:00Z' }
  const resubmitted = await article.submitArticle(1, { expectedVersion: cancelled.version, requireSubmissionId: true })
  assert.equal(resubmitted.version, 8)
  assert.equal(resubmitted.submissionId, 'submission-3')

  response = { status: 'DRAFT', submissionId: 'submission-3', updatedAt: '2026-09-10T08:03:00Z' }
  await assert.rejects(article.cancelReview(1, { expectedVersion: 8, expectedSubmissionId: 'submission-3' }), /version/)
})

test('editor page has no inferred 30-minute cooldown and uses only explicit 429 metadata', async () => {
  const page = await source('src/pages/article/ArticleEditorPage.vue')
  assert.doesNotMatch(page, /PUBLISH_COOLDOWN_MS|lastSubmittedAtTimestamp|ARTICLE_PUBLISH_COOLDOWN_PREFIX/)
  assert.match(page, /candidate.status !== 429 && candidate.code !== 429/)
  assert.match(page, /nextSubmitAt/)
  assert.match(page, /retryAfter/)
  assert.match(page, /expectedVersion: article.version/)
  assert.match(page, /expectedSubmissionId: article.submissionId/)
  assert.match(page, /version: result.version/)
  assert.match(page, /submissionId: result.submissionId/)
})

test('editor save catch path does not clear dirty state or reload detail after 409', async () => {
  const component = await source('src/features/article-editor/ui/ArticleEditorForm.vue')
  const persistBlock = component.slice(component.indexOf('async function persistDraft'), component.indexOf('async function saveDraft'))
  const catchBlock = persistBlock.slice(persistBlock.indexOf('} catch (error)'))
  assert.match(catchBlock, /saveError.value = message/)
  assert.doesNotMatch(catchBlock, /dirty\s*=\s*false/)
  assert.doesNotMatch(catchBlock, /loadArticleDetail/)
})


test('draft box contains only DRAFT, PENDING, and RETURNED', async () => {
  const article = await load('src/shared/utils/article.ts', {
    '@/shared/constants/article': {
      ARTICLE_DURATION_CATEGORY: { QUICK: 'QUICK', SHORT: 'SHORT', DEEP: 'DEEP' },
      ARTICLE_STATUS: {
        DRAFT: 'DRAFT',
        PENDING: 'PENDING',
        RETURNED: 'RETURNED',
        REJECTED: 'REJECTED',
        APPROVED: 'APPROVED',
      },
      ARTICLE_WORDS_PER_MINUTE: 300,
    },
  })

  assert.equal(article.isDraftBoxStatus('DRAFT'), true)
  assert.equal(article.isDraftBoxStatus('pending'), true)
  assert.equal(article.isDraftBoxStatus('RETURNED'), true)
  assert.equal(article.isDraftBoxStatus('REJECTED'), false)
  assert.equal(article.isDraftBoxStatus('APPROVED'), false)
  assert.equal(article.isDraftBoxStatus(undefined), false)
})

test('draft box loaders and status updates enforce the centralized visibility rule', async () => {
  const feature = await source('src/features/draft-box/model/index.ts')
  const store = await source('src/stores/draft.ts')

  assert.match(feature, /draftList\.filter\(\(item\) => isDraftBoxStatus\(item\.status\)\)/)
  assert.match(feature, /drafts\.filter\(\(item\) => isDraftBoxStatus\(item\.status\.value\)\)/)
  assert.match(store, /response\.filter\(\(item\) => isDraftBoxStatus\(item\.status\)\)/)
  assert.match(store, /if \(!isDraftBoxStatus\(status\)\)/)
  assert.doesNotMatch(feature, /ARTICLE_STATUS\.REJECTED\]:/)
  assert.doesNotMatch(store, /ARTICLE_STATUS\.REJECTED\]:/)
})
