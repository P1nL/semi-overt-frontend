import request from '../request'
import type { ArticlePolishReqDto as ArticlePolishRequest, ArticlePolishRespDto as ArticlePolishResponse } from '../generated/contracts'
export type { ArticlePolishSegmentDto as ArticlePolishSegment, ArticlePolishReqDto as ArticlePolishRequest, ArticlePolishRespDto as ArticlePolishResponse } from '../generated/contracts'

export function polishArticle(payload: ArticlePolishRequest, signal?: AbortSignal): Promise<ArticlePolishResponse> {
  return request.post<ArticlePolishResponse>('/articles/ai-polish', payload, {
    signal,
    timeout: 100_000,
    errorPolicy: 'auth',
  })
}
