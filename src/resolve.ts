/**
 * "The name is the address" — the one rule shared by objects, workflows,
 * dashboards and saved queries, in one place so all four resolve identically
 * and their `known` lists read the same when they miss.
 */

/** Anything the workspace addresses by display name and also gives an id. */
export interface NamedEntity {
  id: string;
  name: string;
}

/**
 * Resolves by id, then exact display name, then case-insensitive display name
 * — the order the backend itself resolves in. An id always wins, so an object
 * literally named after another's uuid cannot shadow it.
 */
export function resolveByName<T extends NamedEntity>(
  items: T[],
  nameOrId: string,
): T | undefined {
  const lowered = nameOrId.toLowerCase();
  return (
    items.find((item) => item.id === nameOrId) ??
    items.find((item) => item.name === nameOrId) ??
    items.find((item) => item.name.toLowerCase() === lowered)
  );
}
