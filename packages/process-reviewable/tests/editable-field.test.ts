import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type EditableField, Field } from '../src/editable-field.js';

describe('Field.unedited', () => {
  it('returns { suggested: x, approved: x, wasEdited: false } for primitives', () => {
    const f = Field.unedited('hello');
    expect(f.suggested).toBe('hello');
    expect(f.approved).toBe('hello');
    expect(f.wasEdited).toBe(false);
  });

  it('preserves reference identity for objects', () => {
    const obj = { x: 1 };
    const f = Field.unedited(obj);
    expect(f.suggested).toBe(obj);
    expect(f.approved).toBe(obj);
    expect(f.wasEdited).toBe(false);
  });

  it('works for null and undefined', () => {
    const fNull = Field.unedited(null);
    expect(fNull.suggested).toBeNull();
    expect(fNull.approved).toBeNull();
    expect(fNull.wasEdited).toBe(false);

    const fUndef = Field.unedited(undefined);
    expect(fUndef.suggested).toBeUndefined();
    expect(fUndef.approved).toBeUndefined();
    expect(fUndef.wasEdited).toBe(false);
  });
});

describe('Field.edited', () => {
  it('marks wasEdited true when suggested !== approved (primitives)', () => {
    const f = Field.edited('original', 'modified');
    expect(f.suggested).toBe('original');
    expect(f.approved).toBe('modified');
    expect(f.wasEdited).toBe(true);
  });

  it('marks wasEdited false for structurally identical objects (deep equal)', () => {
    const f = Field.edited({ x: 1 }, { x: 1 });
    expect(f.wasEdited).toBe(false);
  });

  it('marks wasEdited true for structurally different nested objects', () => {
    const f = Field.edited({ x: { y: 1 } }, { x: { y: 2 } });
    expect(f.wasEdited).toBe(true);
  });

  it('marks wasEdited false when suggested === approved (same reference)', () => {
    const obj = { x: 1 };
    const f = Field.edited(obj, obj);
    expect(f.wasEdited).toBe(false);
  });

  it('arrays compare by deep equality', () => {
    expect(Field.edited([1, 2, 3], [1, 2, 3]).wasEdited).toBe(false);
    expect(Field.edited([1, 2, 3], [1, 2, 4]).wasEdited).toBe(true);
  });
});

describe('Field.rejected', () => {
  it('approved is null, wasEdited false', () => {
    const f = Field.rejected('hello');
    expect(f.suggested).toBe('hello');
    expect(f.approved).toBeNull();
    expect(f.wasEdited).toBe(false);
  });

  it('preserves suggested reference', () => {
    const obj = { x: 1 };
    const f = Field.rejected(obj);
    expect(f.suggested).toBe(obj);
  });
});

describe('EditableField — property test (one of 5 M0 properties)', () => {
  it('Field.unedited has wasEdited=false and approved===suggested for any value', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const f: EditableField<unknown> = Field.unedited(value);
        return f.wasEdited === false && Object.is(f.approved, value);
      }),
    );
  });

  it('Field.edited(s, a).wasEdited === !isDeepStrictEqual(s, a) for any pair', () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (s, a) => {
        const f = Field.edited(s, a);
        return f.wasEdited === !isDeepStrictEqual(s, a);
      }),
    );
  });

  it('Field.rejected always has approved=null and wasEdited=false', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const f = Field.rejected(value);
        return f.approved === null && f.wasEdited === false;
      }),
    );
  });
});
