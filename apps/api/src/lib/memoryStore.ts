// In-memory store used as fallback when the database is unavailable.
// Data persists as long as the API process is running.

const store = new Map<string, any[]>();

export function getAll(collection: string): any[] {
  return store.get(collection) || [];
}

export function getById(collection: string, id: string): any | undefined {
  return getAll(collection).find((item) => item.id === id);
}

export function insert(collection: string, item: any): void {
  if (!store.has(collection)) store.set(collection, []);
  store.get(collection)!.push(item);
}

export function update(collection: string, id: string, data: Record<string, any>): void {
  const items = getAll(collection);
  const idx = items.findIndex((item) => item.id === id);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...data };
  }
}

export function remove(collection: string, id: string): void {
  const items = getAll(collection);
  const idx = items.findIndex((item) => item.id === id);
  if (idx >= 0) {
    items[idx].isArchived = true;
  }
}
