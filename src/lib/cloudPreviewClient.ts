// Vite resolves the synchronous preview factory here only in a cloud build.
export function createDemoClient():never {
  throw new Error('Practice data is unavailable in a cloud build.');
}
