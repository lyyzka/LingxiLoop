import type { QueryResult } from '@openplait/core'

export interface AnalyticsResponse {
  observedAt: string
  results: { summary: QueryResult; trend: QueryResult; models: QueryResult; recentRuns: QueryResult }
}

export function frameRows(result: QueryResult | undefined): Record<string, unknown>[] {
  const frame = result?.frames[0]
  if (!frame) return []
  return Array.from({ length: frame.length }, (_, index) => Object.fromEntries(frame.fields.map((field) => [field.name, field.values[index]])))
}

export function metricNumber(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key])
  return Number.isFinite(value) ? value : 0
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function trendData(result: QueryResult | undefined) {
  return frameRows(result).map((row) => ({
    time: new Date(String(row.time)).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    运行: metricNumber(row, 'runs'),
    失败: metricNumber(row, 'failures'),
  }))
}
