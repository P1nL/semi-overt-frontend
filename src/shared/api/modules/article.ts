import request from '../request'
import {
    normalizeArticleDetailDto,
    type BackendArticleCardResp,
    type BackendArticleDetailResp,
} from '../adapters'
import { ARTICLE_STATUS } from '@/shared/constants/article'
import { normalizeBackendDateTime } from '@/shared/utils/dateTime'
import { parseOptionalNonnegativeSafeInteger, requireBackendResponseDateTime } from '../contract'
import { ApiBusinessError } from '@/shared/types/api'
import type {
    AdminDeleteArticleRespDto,
    ArticleDetailRespDto,
    CancelReviewRespDto,
    CreateArticleRespDto,
    DraftItemRespDto,
    SaveDraftReqDto,
    SaveDraftRespDto,
    SubmitArticleRespDto,
} from '../../types/api'

const ARTICLE_BASE = '/articles'
const ADMIN_ARTICLE_BASE = '/admin/articles'
const PUBLIC_ARTICLE_DETAIL_PATH_PATTERN = /^\/articles\/[^/]+\/?$/
const DRAFT_BOX_STATUSES = new Set<string>([
    ARTICLE_STATUS.DRAFT,
    ARTICLE_STATUS.PENDING,
    ARTICLE_STATUS.RETURNED,
    ARTICLE_STATUS.REJECTED,
])

function isDraftBoxStatus(status?: string | null): boolean {
    return DRAFT_BOX_STATUSES.has(status?.toUpperCase?.() ?? '')
}

function isPublicArticleDetailRoute(): boolean {
    return typeof window !== 'undefined' && PUBLIC_ARTICLE_DETAIL_PATH_PATTERN.test(window.location.pathname)
}

export function createArticle(): Promise<CreateArticleRespDto> {
    return request.post<CreateArticleRespDto>(ARTICLE_BASE)
}

export async function saveDraft(
    articleId: number | string,
    payload: SaveDraftReqDto,
): Promise<SaveDraftRespDto> {
    const article = await request.put<BackendArticleDetailResp>(`${ARTICLE_BASE}/${articleId}/draft`, payload)
    const version = parseOptionalNonnegativeSafeInteger(article.version, 'article.version')

    if (payload.version !== undefined && version === undefined) {
        throw new ApiBusinessError('版本化草稿保存响应缺少 version', {
            code: -2,
            details: article,
        })
    }

    return {
        savedAt: requireBackendResponseDateTime(article.updatedAt, 'article.updatedAt'),
        version,
        wordCount: article.wordCount ?? 0,
        readMinutes: Number(article.readMinutes ?? 0),
        durationCategory: article.durationCategory ?? 'SHORT',
        status: article.status ?? 'DRAFT',
        draftVisible: article.draftVisible === true,
    }
}

export function getDraftList(): Promise<DraftItemRespDto[]> {
    return request.get<BackendArticleCardResp[]>(`${ARTICLE_BASE}/drafts`).then((articles) =>
        articles
            .filter((article) => isDraftBoxStatus(article.status))
            .map((article) => ({
                id: article.id ?? article.articleId ?? 0,
                title: article.title ?? null,
                status: article.status ?? 'DRAFT',
                wordCount: article.wordCount ?? 0,
                updatedAt: normalizeBackendDateTime(article.updatedAt ?? article.createdAt) ?? new Date().toISOString(),
                latestReason: article.latestReason ?? article.rejectReason ?? null,
                draftVisible: article.draftVisible ?? false,
            })),
    )
}

export function getArticleDetail(articleId: number | string): Promise<ArticleDetailRespDto> {
    return request
        .get<BackendArticleDetailResp>(
            `${ARTICLE_BASE}/${articleId}`,
            undefined,
            isPublicArticleDetailRoute()
                ? { withAuth: false, errorPolicy: 'local' }
                : { errorPolicy: 'auth' },
        )
        .then(normalizeArticleDetailDto)
}

export interface SubmitArticleOptions {
    expectedVersion?: number | null
    requireSubmissionId?: boolean
}

export async function submitArticle(
    articleId: number | string,
    options: SubmitArticleOptions = {},
): Promise<SubmitArticleRespDto> {
    const article = await request.post<BackendArticleDetailResp>(`${ARTICLE_BASE}/${articleId}/submit`)
    const version = parseOptionalNonnegativeSafeInteger(article.version, 'article.version')
    const submissionId = article.submissionId?.trim() || null

    if (options.expectedVersion !== null && options.expectedVersion !== undefined && version === undefined) {
        throw new ApiBusinessError('版本化提审响应缺少 version', { code: -2, details: article })
    }
    if (options.requireSubmissionId && !submissionId) {
        throw new ApiBusinessError('版本化提审响应缺少 submissionId', { code: -2, details: article })
    }

    return {
        status: article.status ?? 'PENDING',
        submitCount: article.submitCount ?? 0,
        submissionId,
        version,
        lastSubmittedAt: requireBackendResponseDateTime(
            article.lastSubmittedAt ?? article.updatedAt,
            'article.lastSubmittedAt',
        ),
        updatedAt: normalizeBackendDateTime(article.updatedAt),
    }
}

export interface CancelReviewOptions {
    expectedVersion?: number | null
    expectedSubmissionId?: string | null
}

export async function cancelReview(
    articleId: number | string,
    options: CancelReviewOptions = {},
): Promise<CancelReviewRespDto> {
    const article = await request.post<BackendArticleDetailResp>(`${ARTICLE_BASE}/${articleId}/cancel-review`)
    const version = parseOptionalNonnegativeSafeInteger(article.version, 'article.version')
    const submissionId = article.submissionId?.trim() || null

    if (options.expectedVersion !== null && options.expectedVersion !== undefined && version === undefined) {
        throw new ApiBusinessError('版本化取消审核响应缺少 version', { code: -2, details: article })
    }
    if (options.expectedSubmissionId && submissionId !== options.expectedSubmissionId) {
        throw new ApiBusinessError('取消审核响应 submissionId 与当前提交不一致', { code: -2, details: article })
    }

    return {
        status: article.status ?? 'DRAFT',
        submissionId,
        version,
        updatedAt: normalizeBackendDateTime(article.updatedAt),
    }
}

export function deleteArticle(articleId: number | string): Promise<null> {
    return request.delete<null>(`${ARTICLE_BASE}/${articleId}`)
}

export function adminDeleteArticle(articleId: number | string): Promise<AdminDeleteArticleRespDto> {
    return request.delete<null>(`${ADMIN_ARTICLE_BASE}/${articleId}`).then(() => ({ ok: true }))
}

export const articleApi = {
    createArticle,
    saveDraft,
    getDraftList,
    getArticleDetail,
    submitArticle,
    cancelReview,
    deleteArticle,
    adminDeleteArticle,
}

export default articleApi
