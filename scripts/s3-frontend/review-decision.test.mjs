import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../../', import.meta.url)
const source = async (path) => readFile(new URL(path, root), 'utf8')

class BusinessError extends Error {
  constructor(message, options = {}) {
    super(message)
    Object.assign(this, options)
  }
}

function createStorage({ throwOnSet = false } = {}) {
  const data = new Map()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (throwOnSet) throw Error('quota')
      data.set(key, value)
    },
    removeItem: (key) => data.delete(key),
    data,
  }
}

async function loadDecisionModule({ storage, reviewApi, uuids = [] }) {
  const exports = {}
  const code = ts.transpileModule(await source('src/features/review-action/model/review-decision.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  let uuidIndex = 0
  const crypto = {
    randomUUID: () => uuids[uuidIndex++] ?? `00000000-0000-4000-8000-${String(uuidIndex).padStart(12, '0')}`,
  }
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      if (name === '@/shared/api/modules/review') return { reviewApi }
      if (name === '@/shared/api/contract') return {
        requireBackendResponseDateTime(value) {
          if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
            throw new BusinessError('bad date', { code: -2 })
          }
          return value
        },
      }
      if (name === '@/shared/types/api') return { ApiBusinessError: BusinessError }
      throw Error(name)
    },
    window: { sessionStorage: storage },
    globalThis: { crypto },
    crypto,
    setTimeout,
    Date,
    JSON,
    Object,
    String,
    Number,
    Math,
    Uint8Array,
    Array,
    Error,
  })
  return exports
}

const context = { submissionId: 'submission-7', articleVersion: 12, submitCount: 3, userId: 99 }
const values = { action: 'APPROVE', reason: '' }

test('unknown result polls exactly 500/1000/2000/4000 and retry reuses the same key', async () => {
  const storage = createStorage()
  const posted = []
  const payloads = []
  const queried = []
  const delays = []
  const reviewApi = {
    async submitReviewAction(_articleId, payload) {
      posted.push(payload.decisionId)
      payloads.push(payload)
      throw new BusinessError('upstream unavailable', { code: 503, status: 503 })
    },
    async getReviewDecisionStatus(_articleId, decisionId) {
      queried.push(decisionId)
      throw new BusinessError('not found', { code: 404, status: 404 })
    },
  }
  const decision = await loadDecisionModule({
    storage, reviewApi, uuids: ['11111111-1111-4111-8111-111111111111'],
  })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      decision.executeReviewDecision(7, values, context, { sleep: async (delay) => delays.push(delay) }),
      (error) => error.details?.state === 'UNKNOWN' && error.details?.decisionId === posted[0],
    )
  }

  assert.deepEqual(posted, [posted[0], posted[0]])
  assert.ok(payloads.every((payload) => payload.submissionId === context.submissionId))
  assert.ok(payloads.every((payload) => payload.expectedVersion === context.articleVersion))
  assert.ok(payloads.every((payload) => payload.decisionId === posted[0]))
  assert.equal(queried.length, 8)
  assert.ok(queried.every((decisionId) => decisionId === posted[0]))
  assert.deepEqual(delays, [500, 1000, 2000, 4000, 500, 1000, 2000, 4000])
})

test('session reload and storage write failure both preserve the same unknown key', async () => {
  const storage = createStorage()
  const seen = []
  const unknownApi = {
    async submitReviewAction(_articleId, payload) { seen.push(payload.decisionId); throw new BusinessError('timeout', { status: 503, code: 503 }) },
    async getReviewDecisionStatus() { throw new BusinessError('legacy missing', { status: 404, code: 404 }) },
  }
  const first = await loadDecisionModule({ storage, reviewApi: unknownApi, uuids: ['22222222-2222-4222-8222-222222222222'] })
  await assert.rejects(first.executeReviewDecision(7, values, context, { sleep: async () => {} }))
  const reloaded = await loadDecisionModule({ storage, reviewApi: unknownApi, uuids: ['33333333-3333-4333-8333-333333333333'] })
  await assert.rejects(reloaded.executeReviewDecision(7, values, context, { sleep: async () => {} }))
  assert.equal(seen[0], seen[1])

  const brokenStorage = createStorage({ throwOnSet: true })
  const fallbackSeen = []
  const fallbackApi = {
    async submitReviewAction(_articleId, payload) { fallbackSeen.push(payload.decisionId); throw new BusinessError('timeout', { status: 503, code: 503 }) },
    async getReviewDecisionStatus() { throw new BusinessError('missing', { status: 404, code: 404 }) },
  }
  const fallback = await loadDecisionModule({ brokenStorage, storage: brokenStorage, reviewApi: fallbackApi, uuids: ['44444444-4444-4444-8444-444444444444'] })
  await assert.rejects(fallback.executeReviewDecision(7, values, context, { sleep: async () => {} }))
  await assert.rejects(fallback.executeReviewDecision(7, values, context, { sleep: async () => {} }))
  assert.equal(fallbackSeen[0], fallbackSeen[1])
})

test('final key remains stable until submission/version/user fingerprint changes', async () => {
  const storage = createStorage()
  const posted = []
  const reviewApi = {
    async submitReviewAction(_articleId, payload) {
      posted.push(payload.decisionId)
      return { httpStatus: 200, decisionId: payload.decisionId, state: 'FINAL', status: 'APPROVED', updatedAt: '2026-09-10T08:00:00Z', version: 13 }
    },
    async getReviewDecisionStatus() { throw Error('should not query') },
  }
  const decision = await loadDecisionModule({ storage, reviewApi, uuids: [
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
    '77777777-7777-4777-8777-777777777777',
  ] })

  await decision.executeReviewDecision(7, values, context)
  await decision.executeReviewDecision(7, values, context)
  assert.equal(posted[0], posted[1])
  await decision.executeReviewDecision(7, values, { ...context, articleVersion: 13 })
  await decision.executeReviewDecision(7, values, { ...context, userId: 100 })
  assert.notEqual(posted[1], posted[2])
  assert.notEqual(posted[1], posted[3])
})

test('202/PROCESSING never succeeds; query FINAL requires exact decisionId/status/updatedAt', async () => {
  const storage = createStorage()
  let mode = 'missing-id'
  const reviewApi = {
    async submitReviewAction(_articleId, payload) {
      return { httpStatus: 202, decisionId: payload.decisionId, state: 'PROCESSING', status: null, updatedAt: null }
    },
    async getReviewDecisionStatus(_articleId, decisionId) {
      if (mode === 'missing-id') return { httpStatus: 200, decisionId: '', state: 'FINAL', status: 'APPROVED', updatedAt: '2026-09-10T08:00:00Z' }
      if (mode === 'wrong-id') return { httpStatus: 200, decisionId: 'different', state: 'FINAL', status: 'APPROVED', updatedAt: '2026-09-10T08:00:00Z' }
      if (mode === 'missing-status') return { httpStatus: 200, decisionId, state: 'FINAL', status: null, updatedAt: '2026-09-10T08:00:00Z' }
      if (mode === 'missing-time') return { httpStatus: 200, decisionId, state: 'FINAL', status: 'APPROVED', updatedAt: null }
      return { httpStatus: 200, decisionId, state: 'FINAL', status: 'APPROVED', updatedAt: '2026-09-10T08:00:00Z', version: 13 }
    },
  }
  const decision = await loadDecisionModule({ storage, reviewApi, uuids: ['88888888-8888-4888-8888-888888888888'] })

  for (const nextMode of ['missing-id', 'wrong-id', 'missing-status', 'missing-time']) {
    mode = nextMode
    await assert.rejects(decision.executeReviewDecision(7, values, context, { sleep: async () => {} }))
  }
  mode = 'valid'
  const result = await decision.executeReviewDecision(7, values, context, { sleep: async () => {} })
  assert.equal(result.state, 'FINAL')
  assert.equal(result.status, 'APPROVED')
  assert.equal(result.version, 13)
})

test('new protocol FINAL POST must include decisionId', async () => {
  const storage = createStorage()
  const reviewApi = {
    async submitReviewAction() {
      return { httpStatus: 200, decisionId: '', state: 'FINAL', status: 'APPROVED', updatedAt: '2026-09-10T08:00:00Z' }
    },
    async getReviewDecisionStatus() { throw Error('should not query') },
  }
  const decision = await loadDecisionModule({ storage, reviewApi, uuids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] })
  await assert.rejects(decision.executeReviewDecision(7, values, context), /decisionId/)
})

test('unknown attempts are not evicted when more than 32 fingerprints exist', async () => {
  const storage = createStorage()
  const decision = await loadDecisionModule({ storage, reviewApi: {} })
  const firstInput = { articleId: 1, action: 'APPROVE', reason: '', submissionId: 's-1', articleVersion: 1, userId: 99 }
  const first = decision.getOrCreateReviewDecisionId(firstInput)

  for (let index = 2; index <= 40; index += 1) {
    decision.getOrCreateReviewDecisionId({
      ...firstInput,
      articleId: index,
      submissionId: `s-${index}`,
      articleVersion: index,
    })
  }

  assert.equal(decision.getOrCreateReviewDecisionId(firstInput), first)
  const persisted = JSON.parse(storage.getItem('now.reviewDecisionAttempts.v1'))
  assert.equal(Object.keys(persisted).length, 40)
  assert.ok(Object.values(persisted).every((attempt) => attempt.state === 'UNKNOWN'))
})

test('legacy monolith POST 200 may omit decisionId only when final status and time are present', async () => {
  const storage = createStorage()
  const reviewApi = {
    async submitReviewAction() {
      return { httpStatus: 200, decisionId: '', state: '', status: 'APPROVED', updatedAt: '2026-09-10T08:00:00Z' }
    },
    async getReviewDecisionStatus() { throw Error('should not query') },
  }
  const decision = await loadDecisionModule({ storage, reviewApi, uuids: ['99999999-9999-4999-8999-999999999999'] })
  const result = await decision.executeReviewDecision(7, values, context)
  assert.equal(result.status, 'APPROVED')
  assert.equal(result.decisionId, '99999999-9999-4999-8999-999999999999')
})
