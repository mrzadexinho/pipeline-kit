import type { DatasetClient } from 'apify-client';

const PAGE_SIZE = 1_000;

/**
 * Async-generator that yields all raw items from an Apify dataset, fetching
 * in PAGE_SIZE-sized batches until every item has been returned.
 */
export async function* paginateDataset(
  datasetClient: DatasetClient,
  pageSize: number = PAGE_SIZE,
): AsyncGenerator<unknown> {
  let offset = 0;

  while (true) {
    const page = await datasetClient.listItems({ offset, limit: pageSize });
    const { items } = page;

    for (const item of items) {
      yield item;
    }

    if (items.length < pageSize) {
      break;
    }

    offset += items.length;
  }
}
