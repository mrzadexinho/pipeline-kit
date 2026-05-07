import { describe, expect, it, vi } from 'vitest';
import { paginateDataset } from '../src/dataset-paginate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake DatasetClient whose listItems returns batches of the given items. */
function buildDatasetClient(allItems: unknown[], pageSize = 1_000) {
  const listItems = vi
    .fn()
    .mockImplementation(
      async ({ offset = 0, limit = pageSize }: { offset?: number; limit?: number }) => {
        const slice = allItems.slice(offset, offset + limit);
        return {
          items: slice,
          total: allItems.length,
          count: slice.length,
          offset,
          limit,
          desc: false,
        };
      },
    );

  // Cast to minimal shape paginateDataset needs
  return { listItems } as unknown as Parameters<typeof paginateDataset>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('paginateDataset', () => {
  it('2500 items → 3 batches (1000 + 1000 + 500) → 2500 atoms total', async () => {
    const allItems = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const client = buildDatasetClient(allItems, 1_000);

    const collected: unknown[] = [];
    for await (const item of paginateDataset(client, 1_000)) {
      collected.push(item);
    }

    expect(collected).toHaveLength(2500);
    expect(collected[0]).toEqual({ id: 0 });
    expect(collected[2499]).toEqual({ id: 2499 });

    // listItems should have been called exactly 3 times
    expect((client as { listItems: ReturnType<typeof vi.fn> }).listItems).toHaveBeenCalledTimes(3);
  });

  it('0 items → 0 atoms, no error', async () => {
    const client = buildDatasetClient([], 1_000);

    const collected: unknown[] = [];
    for await (const item of paginateDataset(client, 1_000)) {
      collected.push(item);
    }

    expect(collected).toHaveLength(0);
    expect((client as { listItems: ReturnType<typeof vi.fn> }).listItems).toHaveBeenCalledOnce();
  });
});
