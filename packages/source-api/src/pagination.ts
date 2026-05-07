import type { ApiSourceConfig } from './api-source.js';

export type PaginationState =
  | { type: 'cursor'; cursor: string | null; done: boolean }
  | { type: 'offset'; offset: number; done: boolean }
  | { type: 'page'; page: number; done: boolean }
  | { type: 'none'; done: boolean };

export function initialState(config: ApiSourceConfig<unknown>): PaginationState {
  const p = config.paginate ?? { type: 'none' };
  switch (p.type) {
    case 'cursor':
      return { type: 'cursor', cursor: null, done: false };
    case 'offset':
      return { type: 'offset', offset: 0, done: false };
    case 'page':
      return { type: 'page', page: 1, done: false };
    case 'none':
      return { type: 'none', done: false };
  }
}

export function applyPaginationParams(
  url: URL,
  state: PaginationState,
  config: ApiSourceConfig<unknown>,
): void {
  const p = config.paginate ?? { type: 'none' };
  switch (p.type) {
    case 'cursor':
      if (state.type === 'cursor' && state.cursor !== null) {
        url.searchParams.set(p.cursorParam, state.cursor);
      }
      break;
    case 'offset':
      if (state.type === 'offset') {
        url.searchParams.set(p.offsetParam, String(state.offset));
        url.searchParams.set('limit', String(p.pageSize));
      }
      break;
    case 'page':
      if (state.type === 'page') {
        url.searchParams.set(p.pageParam, String(state.page));
        url.searchParams.set('per_page', String(p.pageSize));
      }
      break;
    case 'none':
      break;
  }
}

export interface PageBody {
  items: unknown[];
  next_cursor?: string | null;
}

export function advanceState(
  state: PaginationState,
  config: ApiSourceConfig<unknown>,
  body: PageBody,
): PaginationState {
  const p = config.paginate ?? { type: 'none' };
  switch (p.type) {
    case 'cursor': {
      const next = body.next_cursor ?? null;
      return { type: 'cursor', cursor: next, done: next === null || next === undefined };
    }
    case 'offset': {
      if (state.type !== 'offset') return { ...state, done: true };
      const fetched = body.items.length;
      if (fetched < p.pageSize) {
        return { type: 'offset', offset: state.offset + fetched, done: true };
      }
      return { type: 'offset', offset: state.offset + fetched, done: false };
    }
    case 'page': {
      if (state.type !== 'page') return { ...state, done: true };
      const fetched = body.items.length;
      if (fetched < p.pageSize) {
        return { type: 'page', page: state.page + 1, done: true };
      }
      return { type: 'page', page: state.page + 1, done: false };
    }
    case 'none':
      return { type: 'none', done: true };
  }
}
