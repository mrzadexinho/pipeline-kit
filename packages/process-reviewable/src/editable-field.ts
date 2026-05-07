import { isDeepStrictEqual } from 'node:util';

export interface EditableField<T> {
  readonly suggested: T;
  readonly approved: T | null;
  readonly wasEdited: boolean;
}

export const Field = {
  unedited<T>(value: T): EditableField<T> {
    return { suggested: value, approved: value, wasEdited: false };
  },

  edited<T>(suggested: T, approved: T): EditableField<T> {
    return {
      suggested,
      approved,
      wasEdited: !isDeepStrictEqual(suggested, approved),
    };
  },

  rejected<T>(suggested: T): EditableField<T> {
    return { suggested, approved: null, wasEdited: false };
  },
} as const;
