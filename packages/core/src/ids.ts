import { randomUUID } from 'node:crypto';
import { ulid } from 'ulid';

const UUID_TRUNC_LEN = 16;

const truncatedUuid = (): string => randomUUID().replaceAll('-', '').slice(0, UUID_TRUNC_LEN);

export const run = (): string => `pk_run_${ulid()}`;
export const atom = (): string => `pk_atom_${ulid()}`;
export const evt = (): string => `pk_evt_${ulid()}`;
export const pipe = (): string => `pk_pipe_${truncatedUuid()}`;
export const src = (): string => `pk_src_${truncatedUuid()}`;
export const proc = (): string => `pk_proc_${truncatedUuid()}`;
export const serve = (): string => `pk_serve_${truncatedUuid()}`;
export const review = (): string => `pk_review_${truncatedUuid()}`;
export const tev = (): string => `pk_tev_${ulid()}`;

export const ids = {
  run,
  atom,
  evt,
  pipe,
  src,
  proc,
  serve,
  review,
  tev,
} as const;
