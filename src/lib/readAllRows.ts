type Page<T> = { data: T[] | null; error: unknown };

// Callers must supply a stable, unique ordering and a bounded date/filter scope.
export async function readAllRows<T>(read: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const page = await read(rows.length, rows.length + 249);
    if (page.error) throw page.error;
    if (!page.data) throw new Error('The server returned no records response.');
    if (!page.data.length) return rows;
    // Continue even for short pages: the project may enforce a smaller API cap.
    rows.push(...page.data);
  }
}
