import { ApiBusinessError } from '@/shared/types/api'
import { normalizeBackendDateTime } from '@/shared/utils/dateTime'

export function parseOptionalNonnegativeSafeInteger(
    value: unknown,
    fieldName = 'version',
): number | undefined {
    if (value === undefined || value === null) return undefined

    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new ApiBusinessError(`响应中的 ${fieldName} 不合法`, {
            code: -2,
            details: { field: fieldName, value },
        })
    }

    return value
}

export function requireBackendResponseDateTime(
    value: unknown,
    fieldName: string,
): string {
    if (typeof value !== 'string') {
        throw new ApiBusinessError(`响应缺少有效的 ${fieldName}`, {
            code: -2,
            details: { field: fieldName, value },
        })
    }

    const normalized = normalizeBackendDateTime(value)
    if (!normalized || Number.isNaN(Date.parse(normalized))) {
        throw new ApiBusinessError(`响应缺少有效的 ${fieldName}`, {
            code: -2,
            details: { field: fieldName, value },
        })
    }

    return normalized
}
