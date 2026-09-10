import { reviewApi, type ReviewDecisionWireResult } from '@/shared/api/modules/review'
import { requireBackendResponseDateTime } from '@/shared/api/contract'
import { ApiBusinessError } from '@/shared/types/api'
import type { ReviewActionRespDto } from '@/shared/types/api'
import type { ReviewActionFormValues } from './review-action.types'

const STORAGE_KEY = 'now.reviewDecisionAttempts.v1'
const MAX_PERSISTED_ATTEMPTS = 32
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FINAL_STATUS_BY_ACTION = {
    APPROVE: 'APPROVED',
    RETURN: 'RETURNED',
    REJECT: 'REJECTED',
} as const

export const REVIEW_DECISION_POLL_DELAYS_MS = [500, 1000, 2000, 4000] as const

export interface ReviewDecisionContext {
    submissionId?: string | null
    articleVersion?: number | null
    submitCount?: number | null
    userId?: number | string | null
}

interface ReviewDecisionAttemptInput extends ReviewDecisionContext {
    articleId: number | string
    action: ReviewActionFormValues['action']
    reason: string
}

type PersistedAttemptState = 'UNKNOWN' | 'FINAL' | 'CONFLICT'

interface PersistedAttempt {
    decisionId: string
    state: PersistedAttemptState
    touchedAt: number
}

type PersistedAttempts = Record<string, PersistedAttempt>

const memoryAttempts: PersistedAttempts = {}

function normalizeReason(reason: string): string {
    return reason.trim()
}

function normalizeSafeInteger(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function hashFingerprint(source: string): string {
    let first = 0x811c9dc5
    let second = 0x9e3779b9

    for (let index = 0; index < source.length; index += 1) {
        const code = source.charCodeAt(index)
        first = Math.imul(first ^ code, 0x01000193) >>> 0
        second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0
    }

    return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}:${source.length}`
}

function fingerprint(input: ReviewDecisionAttemptInput): string {
    return hashFingerprint(JSON.stringify({
        articleId: String(input.articleId),
        action: input.action,
        reason: normalizeReason(input.reason),
        submissionId: input.submissionId?.trim() || null,
        articleVersion: normalizeSafeInteger(input.articleVersion),
        submitCount: normalizeSafeInteger(input.submitCount),
        userId: input.userId == null ? null : String(input.userId),
    }))
}

function sessionStorageOrNull(): Storage | null {
    if (typeof window === 'undefined') return null

    try {
        return window.sessionStorage
    } catch {
        return null
    }
}

function sanitizeAttempts(parsed: unknown): PersistedAttempts {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) => {
            if (!value || typeof value !== 'object') return []
            const candidate = value as Partial<PersistedAttempt>
            if (typeof candidate.decisionId !== 'string' || !UUID_PATTERN.test(candidate.decisionId)) return []
            const state = candidate.state === 'FINAL' || candidate.state === 'CONFLICT'
                ? candidate.state
                : 'UNKNOWN'
            const touchedAt = typeof candidate.touchedAt === 'number' && Number.isFinite(candidate.touchedAt)
                ? candidate.touchedAt
                : 0
            return [[key, { decisionId: candidate.decisionId, state, touchedAt }]]
        }),
    ) as PersistedAttempts
}

function readAttempts(): PersistedAttempts {
    const storage = sessionStorageOrNull()
    let persisted: PersistedAttempts = {}

    if (storage) {
        try {
            persisted = sanitizeAttempts(JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}'))
        } catch {
            persisted = {}
        }
    }

    return {
        ...persisted,
        ...memoryAttempts,
    }
}

function boundResolvedAttempts(attempts: PersistedAttempts): PersistedAttempts {
    const unknown = Object.entries(attempts).filter(([, attempt]) => attempt.state === 'UNKNOWN')
    const resolved = Object.entries(attempts)
        .filter(([, attempt]) => attempt.state !== 'UNKNOWN')
        .sort((left, right) => right[1].touchedAt - left[1].touchedAt)
        .slice(0, MAX_PERSISTED_ATTEMPTS)

    return Object.fromEntries([...unknown, ...resolved])
}

function writeAttempts(attempts: PersistedAttempts): void {
    const bounded = boundResolvedAttempts(attempts)
    const storage = sessionStorageOrNull()

    for (const key of Object.keys(memoryAttempts)) delete memoryAttempts[key]

    if (storage) {
        try {
            storage.setItem(STORAGE_KEY, JSON.stringify(bounded))
            return
        } catch {
            // Fall through to the in-memory mirror. readAttempts merges this first.
        }
    }

    Object.assign(memoryAttempts, bounded)
}

function createDecisionId(): string {
    const cryptoApi = globalThis.crypto
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()

    if (!cryptoApi?.getRandomValues) {
        throw new Error('当前环境无法生成审核 decisionId')
    }

    const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function getOrCreateReviewDecisionId(input: ReviewDecisionAttemptInput): string {
    const key = fingerprint(input)
    const attempts = readAttempts()
    const existing = attempts[key]
    if (existing) {
        writeAttempts({
            ...attempts,
            [key]: { ...existing, touchedAt: Date.now() },
        })
        return existing.decisionId
    }

    const decisionId = createDecisionId()
    writeAttempts({
        ...attempts,
        [key]: { decisionId, state: 'UNKNOWN', touchedAt: Date.now() },
    })
    return decisionId
}

export function markReviewDecisionAttempt(
    input: ReviewDecisionAttemptInput,
    decisionId: string,
    state: PersistedAttemptState,
): void {
    const key = fingerprint(input)
    const attempts = readAttempts()
    if (attempts[key]?.decisionId !== decisionId) return

    writeAttempts({
        ...attempts,
        [key]: { decisionId, state, touchedAt: Date.now() },
    })
}

function isConflict(error: unknown): boolean {
    return error instanceof ApiBusinessError && (error.code === 409 || error.status === 409)
}

function isRecoverableSubmissionError(error: unknown): boolean {
    if (!(error instanceof ApiBusinessError)) return false
    const status = error.status ?? (error.code >= 100 && error.code <= 599 ? error.code : undefined)
    return (status === undefined && error.code === -1)
        || status === 408
        || status === 500
        || status === 502
        || status === 503
        || status === 504
}

function isRecoverableQueryError(error: unknown): boolean {
    if (!(error instanceof ApiBusinessError)) return false
    const status = error.status ?? (error.code >= 100 && error.code <= 599 ? error.code : undefined)
    return (status === undefined && error.code === -1)
        || status === 404
        || (status !== undefined && status >= 500 && status <= 599)
}

function assertMatchingDecisionId(result: ReviewDecisionWireResult, expectedDecisionId: string): void {
    if (result.decisionId && result.decisionId !== expectedDecisionId) {
        throw new ApiBusinessError('审核响应 decisionId 与本次操作不一致', {
            code: -2,
            details: result,
        })
    }
}

function asFinalResult(
    result: ReviewDecisionWireResult,
    expectedDecisionId: string,
    expectedStatus: string,
    source: 'submit' | 'query',
): ReviewActionRespDto | null {
    if (result.httpStatus !== 200) return null
    assertMatchingDecisionId(result, expectedDecisionId)
    const state = result.state?.toUpperCase?.() || ''

    if (state === 'CONFLICT') {
        throw new ApiBusinessError('该文章已被其他管理员处理，请刷新后查看', {
            code: 409,
            status: 409,
            details: result,
        })
    }

    if (source === 'submit' && state && !result.decisionId) {
        throw new ApiBusinessError('审核最终响应缺少 decisionId', { code: -2, details: result })
    }

    if (source === 'query') {
        if (!result.decisionId) {
            throw new ApiBusinessError('审核状态查询缺少 decisionId', { code: -2, details: result })
        }
        if (!state) {
            throw new ApiBusinessError('审核状态查询缺少 state', { code: -2, details: result })
        }
        if (state !== 'FINAL') return null
    } else {
        if (state && state !== 'FINAL') return null
        if (state === 'FINAL' && !result.decisionId) {
            throw new ApiBusinessError('审核最终响应缺少 decisionId', { code: -2, details: result })
        }
        if (!state && result.decisionId) {
            throw new ApiBusinessError('审核响应缺少最终 state', { code: -2, details: result })
        }
    }

    const status = result.status?.toUpperCase?.() || ''
    if (!status) {
        throw new ApiBusinessError('审核最终响应缺少 status', { code: -2, details: result })
    }

    if (status !== expectedStatus) {
        throw new ApiBusinessError('审核最终响应状态与本次操作不一致', {
            code: -1,
            details: result,
        })
    }

    const updatedAt = requireBackendResponseDateTime(result.updatedAt, 'review.updatedAt')
    return {
        decisionId: expectedDecisionId,
        state: 'FINAL',
        status,
        reviewedAt: updatedAt,
        updatedAt,
        version: result.version,
    }
}

function unknownDecisionError(decisionId: string): ApiBusinessError {
    return new ApiBusinessError('审核结果尚未确认，请使用同一操作重试', {
        code: -1,
        details: {
            decisionId,
            state: 'UNKNOWN',
        },
    })
}

async function sleep(delayMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
}

export async function executeReviewDecision(
    articleId: number | string,
    values: ReviewActionFormValues,
    context: ReviewDecisionContext = {},
    options: { sleep?: (delayMs: number) => Promise<void> } = {},
): Promise<ReviewActionRespDto> {
    const attemptInput: ReviewDecisionAttemptInput = {
        articleId,
        action: values.action,
        reason: values.reason,
        ...context,
    }
    const decisionId = getOrCreateReviewDecisionId(attemptInput)
    const expectedStatus = FINAL_STATUS_BY_ACTION[values.action]
    const expectedVersion = normalizeSafeInteger(context.articleVersion)
    const wait = options.sleep ?? sleep

    try {
        const submitted = await reviewApi.submitReviewAction(articleId, {
            action: values.action,
            reason: normalizeReason(values.reason) || undefined,
            decisionId,
            ...(context.submissionId?.trim() ? { submissionId: context.submissionId.trim() } : {}),
            ...(expectedVersion !== null ? { expectedVersion } : {}),
        })

        if (submitted.httpStatus === 200) {
            const final = asFinalResult(submitted, decisionId, expectedStatus, 'submit')
            if (final) {
                markReviewDecisionAttempt(attemptInput, decisionId, 'FINAL')
                return final
            }
        }
    } catch (error) {
        if (isConflict(error)) {
            markReviewDecisionAttempt(attemptInput, decisionId, 'CONFLICT')
            throw error
        }
        if (!isRecoverableSubmissionError(error)) throw error
    }

    for (const delayMs of REVIEW_DECISION_POLL_DELAYS_MS) {
        await wait(delayMs)

        try {
            const queried = await reviewApi.getReviewDecisionStatus(articleId, decisionId)
            const final = asFinalResult(queried, decisionId, expectedStatus, 'query')
            if (final) {
                markReviewDecisionAttempt(attemptInput, decisionId, 'FINAL')
                return final
            }
        } catch (error) {
            if (isConflict(error)) {
                markReviewDecisionAttempt(attemptInput, decisionId, 'CONFLICT')
                throw error
            }
            if (!isRecoverableQueryError(error)) throw error
        }
    }

    markReviewDecisionAttempt(attemptInput, decisionId, 'UNKNOWN')
    throw unknownDecisionError(decisionId)
}
