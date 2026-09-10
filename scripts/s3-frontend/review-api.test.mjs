import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../../', import.meta.url)
const source = async (path) => readFile(new URL(path, root), 'utf8')

async function loadReviewApi(request) {
  const exports = {}
  const code = ts.transpileModule(await source('src/shared/api/modules/review.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, {
    exports,
    require: (name) => {
      if (name === '../request') return { default: request }
      if (name === '../response') return {
        isApiResponse: (value) => Boolean(value && typeof value.code === 'number' && 'data' in value),
        unwrapApiResponse: async (value) => value.data,
      }
      if (name === '../contract') return { parseOptionalNonnegativeSafeInteger: (value) => value }
      if (name === '@/shared/utils/dateTime') return { normalizeBackendDateTime: (value) => value ?? null }
      if (name === '@/shared/types/api') return { ApiBusinessError: Error }
      if (name === '../adapters') return { normalizePendingReviewListResp: (value) => value, normalizeReviewLogListResp: (value) => value }
      throw Error(name)
    },
  })
  return exports
}

test('review POST carries the stable key in body/header and CAS baseline fields', async () => {
  let captured
  const api = await loadReviewApi({
    async postRawResponse(url, body, config) {
      captured = { url, body, config }
      return { status: 200, headers: {}, data: { code: 200, message: 'ok', data: { status: 'APPROVED', updatedAt: '2026-09-10T08:00:00Z' } } }
    },
  })
  const payload = {
    action: 'APPROVE',
    decisionId: '11111111-1111-4111-8111-111111111111',
    submissionId: 'submission-7',
    expectedVersion: 12,
  }
  await api.submitReviewAction(7, payload)
  assert.equal(captured.url, '/review/7/decision')
  assert.deepEqual(captured.body, payload)
  assert.equal(captured.config.headers['Idempotency-Key'], payload.decisionId)
})

test('decision-status uses scoped local raw response and preserves actual HTTP status', async () => {
  let captured
  const api = await loadReviewApi({
    async getRawResponse(url, params, config) {
      captured = { url, params, config }
      return { status: 202, headers: {}, data: { code: 202, message: 'processing', data: { decisionId: params.decisionId, state: 'PROCESSING' } } }
    },
  })
  const result = await api.getReviewDecisionStatus(7, '11111111-1111-4111-8111-111111111111')
  assert.equal(captured.url, '/review/7/decision-status')
  assert.equal(captured.params.decisionId, result.decisionId)
  assert.equal(captured.config.errorPolicy, 'local')
  assert.equal(result.httpStatus, 202)
  assert.equal(result.state, 'PROCESSING')
})
