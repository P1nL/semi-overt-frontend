import request from '../request'
import { isApiResponse, unwrapApiResponse } from '../response'
import { parseOptionalNonnegativeSafeInteger } from '../contract'
import { normalizeBackendDateTime } from '@/shared/utils/dateTime'
import { ApiBusinessError, type ApiResponse } from '@/shared/types/api'
import {
    normalizePendingReviewListResp,
    normalizeReviewLogListResp,
    type BackendReviewPendingPageResp,
    type BackendReviewLogResp,
} from '../adapters'
import type {
    PageRespDto,
    PaginationParams,
    PendingReviewItemDto,
    ReviewActionReqDto,
    ReviewDecisionStatusRespDto,
    ReviewLogRespDto,
} from '../../types/api'

const REVIEW_BASE = '/review'

interface RawReviewDecisionResp {
    decisionId?: unknown
    state?: unknown
    status?: unknown
    updatedAt?: unknown
    reviewedAt?: unknown
    version?: unknown
}

export interface ReviewDecisionWireResult extends ReviewDecisionStatusRespDto {
    httpStatus: number
}

function readHeader(headers: unknown, names: string[]): string | undefined {
    if (!headers || typeof headers !== 'object') return undefined

    const source = headers as {
        get?: (name: string) => unknown
        [key: string]: unknown
    }

    for (const name of names) {
        const value = typeof source.get === 'function' ? source.get(name) : source[name.toLowerCase()]
        if (typeof value === 'string' && value.trim()) return value.trim()
    }

    return undefined
}

function asRecord(value: unknown): RawReviewDecisionResp {
    return value && typeof value === 'object' ? value as RawReviewDecisionResp : {}
}

function normalizeDecisionResult(
    raw: unknown,
    httpStatus: number,
    headerDecisionId?: string,
): ReviewDecisionWireResult {
    const record = asRecord(raw)
    const bodyDecisionId = typeof record.decisionId === 'string' && record.decisionId.trim()
        ? record.decisionId.trim()
        : undefined

    if (bodyDecisionId && headerDecisionId && bodyDecisionId !== headerDecisionId) {
        throw new ApiBusinessError('审核响应中的 decisionId 不一致', {
            code: -2,
            details: { bodyDecisionId, headerDecisionId },
        })
    }

    const rawUpdatedAt = typeof record.updatedAt === 'string'
        ? record.updatedAt
        : typeof record.reviewedAt === 'string'
            ? record.reviewedAt
            : null

    return {
        httpStatus,
        decisionId: bodyDecisionId ?? headerDecisionId ?? '',
        state: typeof record.state === 'string' ? record.state : '',
        status: typeof record.status === 'string' ? record.status : null,
        updatedAt: normalizeBackendDateTime(rawUpdatedAt),
        version: parseOptionalNonnegativeSafeInteger(record.version, 'review.version'),
    }
}

export function getPendingReviews(params?: PaginationParams): Promise<PageRespDto<PendingReviewItemDto>> {
    return request.get<BackendReviewPendingPageResp>(`${REVIEW_BASE}/pending`, params).then(normalizePendingReviewListResp)
}

export async function submitReviewAction(
    articleId: number | string,
    payload: ReviewActionReqDto,
): Promise<ReviewDecisionWireResult> {
    const response = await request.postRawResponse<unknown>(
        `${REVIEW_BASE}/${articleId}/decision`,
        payload,
        {
            headers: {
                'Idempotency-Key': payload.decisionId,
            },
        },
    )
    const headerDecisionId = readHeader(response.headers, [
        'decisionId',
        'Decision-Id',
        'X-Decision-Id',
        'Idempotency-Key',
    ])

    if (isApiResponse(response.data)) {
        if (response.data.code === 202) {
            return normalizeDecisionResult(response.data.data, 202, headerDecisionId)
        }

        const raw = await unwrapApiResponse<unknown>(response.data, { errorPolicy: 'auth' })
        return normalizeDecisionResult(raw, response.status, headerDecisionId)
    }

    return normalizeDecisionResult(response.data, response.status, headerDecisionId)
}

export async function getReviewDecisionStatus(
    articleId: number | string,
    decisionId: string,
): Promise<ReviewDecisionWireResult> {
    const response = await request.getRawResponse<unknown>(
        `${REVIEW_BASE}/${articleId}/decision-status`,
        { decisionId },
        { errorPolicy: 'local' },
    )
    if (isApiResponse(response.data)) {
        if (response.data.code === 202) {
            return normalizeDecisionResult(response.data.data, 202)
        }

        const raw = await unwrapApiResponse<unknown>(response.data, { errorPolicy: 'local' })
        return normalizeDecisionResult(raw, response.status)
    }

    return normalizeDecisionResult(response.data, response.status)
}

export function getReviewLogs(articleId: number | string): Promise<ReviewLogRespDto[]> {
    return request.get<BackendReviewLogResp[]>(`${REVIEW_BASE}/${articleId}/logs`).then(normalizeReviewLogListResp)
}

export const reviewApi = {
    getPendingReviews,
    submitReviewAction,
    getReviewDecisionStatus,
    getReviewLogs,
}

export default reviewApi
