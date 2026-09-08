// JSONB preserves values and array order, but not object property order.
// Compare/hash JSON values consistently before and after database round trips.
export function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Expected a JSON value');
  function sorted(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sorted);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => [key, sorted(child)]));
    }
    return input;
  }
  return JSON.stringify(sorted(JSON.parse(encoded)));
}
