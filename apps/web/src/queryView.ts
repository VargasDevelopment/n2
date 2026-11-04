import type { UseQueryResult } from '@tanstack/react-query';

/**
 * What a view may show for a query. A query blocks its view only while it has no data. Once it has
 * data, a failed refresh keeps that last confirmed data, and the failure is reported beside it,
 * never instead of it. Views read query state through this, not `isError`: TanStack sets `isError`
 * when a refresh fails over data it keeps (lint enforces this in apps/web/src).
 */
export type QueryView<Data> =
  | { status: 'loading' }
  | { status: 'unavailable'; error: Error }
  | { status: 'ready'; data: Data; refreshError: Error | null };

export const queryView = <Data>({
  data,
  error
}: Pick<UseQueryResult<Data>, 'data' | 'error'>): QueryView<Data> =>
  data !== undefined
    ? { status: 'ready', data, refreshError: error }
    : error
      ? { status: 'unavailable', error }
      : { status: 'loading' };
