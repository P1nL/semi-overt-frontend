import { useMutation } from '@tanstack/vue-query'
import { polishArticle, type ArticlePolishRequest } from '../modules/article-polish'

/** User-triggered, potentially billable generation: never retry or persist it automatically. */
export function useArticlePolishMutation() {
  return useMutation({
    mutationFn: ({ payload, signal }: { payload: ArticlePolishRequest; signal: AbortSignal }) =>
      polishArticle(payload, signal),
    retry: false,
    gcTime: 0,
  })
}
