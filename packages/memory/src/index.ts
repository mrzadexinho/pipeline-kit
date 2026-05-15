export type { MemoryAdapter, MemoryError } from './types.js';
export type { Listable } from './markers.js';
export { isListable } from './markers.js';

// Re-export Disposable + isDisposable from core (V-2: Disposable lives in core)
export type { Disposable } from '@idriszade/core';
export { isDisposable } from '@idriszade/core';
