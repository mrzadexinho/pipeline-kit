// Cat IX spike #1 — minimal hand-rolled validator.
// zod is not resolvable from repo root devDeps (verified: `node -e require.resolve('zod')` errors).
// Brief allows hand-roll < 50 LOC; this stays inside that budget for the synthetic Job schema.

export type ValidationError = { path: string; message: string };
type Check = (v: unknown, path: string) => ValidationError[];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const ID_RE = /^pk_atom_[A-Z0-9]{26}$/;
export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const REMOTE_VALUES = ['remote', 'hybrid', 'onsite', 'unknown'] as const;

export function validateAtom(v: unknown, path = '$'): ValidationError[] {
  const errs: ValidationError[] = [];
  if (!isObj(v)) return [{ path, message: 'not an object' }];
  if (typeof v.id !== 'string' || !ID_RE.test(v.id))
    errs.push({ path: `${path}.id`, message: `expected pk_atom_<ULID>, got ${String(v.id)}` });
  if (v.object !== 'atom') errs.push({ path: `${path}.object`, message: 'must be "atom"' });
  if (typeof v.created_at !== 'string' || !ISO_RE.test(v.created_at))
    errs.push({ path: `${path}.created_at`, message: 'expected ISO 8601 string' });
  if (!isObj(v.metadata)) errs.push({ path: `${path}.metadata`, message: 'expected object' });
  if (!isObj(v.data)) {
    errs.push({ path: `${path}.data`, message: 'expected object' });
    return errs;
  }
  const d = v.data;
  const strLen = (k: string, min: number, max: number): Check[] => [
    (val, p) =>
      typeof val !== 'string' || val.length < min || val.length > max
        ? [{ path: `${p}.${k}`, message: `expected string ${min}..${max}` }]
        : [],
  ];
  for (const c of strLen('title', 1, 200)) errs.push(...c(d.title, `${path}.data`));
  for (const c of strLen('company', 1, 100)) errs.push(...c(d.company, `${path}.data`));
  if (d.location !== null && typeof d.location !== 'string')
    errs.push({ path: `${path}.data.location`, message: 'string|null' });
  if (d.posted_at !== null && (typeof d.posted_at !== 'string' || !ISO_RE.test(d.posted_at)))
    errs.push({ path: `${path}.data.posted_at`, message: 'ISO|null' });
  for (const k of ['salary_min', 'salary_max'] as const)
    if (d[k] !== null && (typeof d[k] !== 'number' || !Number.isInteger(d[k])))
      errs.push({ path: `${path}.data.${k}`, message: 'int|null' });
  if (typeof d.remote !== 'string' || !(REMOTE_VALUES as readonly string[]).includes(d.remote))
    errs.push({ path: `${path}.data.remote`, message: `enum ${REMOTE_VALUES.join('|')}` });
  if (!Array.isArray(d.tags) || d.tags.length > 20 || d.tags.some((t) => typeof t !== 'string'))
    errs.push({ path: `${path}.data.tags`, message: 'string[] (max 20)' });
  return errs;
}
