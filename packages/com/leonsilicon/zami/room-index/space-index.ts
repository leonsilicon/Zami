// Which spaces each room sits in, from the spaces' child lists.

/**
 * Each child's parent spaces: the spaces whose child list names it, in `spaceIds` order and
 * each once. The reverse of `childIdsOf`, built in one pass over every child list, so asking
 * a room's parents no longer walks every space.
 */
export function indexParents(
  spaceIds: Iterable<string>,
  childIdsOf: (spaceId: string) => readonly string[],
): Map<string, string[]> {
  const parents = new Map<string, string[]>();
  for (const spaceId of spaceIds) {
    for (const childId of childIdsOf(spaceId)) {
      const list = parents.get(childId);
      if (!list) parents.set(childId, [spaceId]);
      // A child listed twice in one space is that space's child once.
      else if (list[list.length - 1] !== spaceId) list.push(spaceId);
    }
  }
  return parents;
}

/**
 * `spaceId` and every space below it, each once: what a space's badge covers. Follows
 * `childSpaceIdsOf` (the child spaces a space lists) depth first, and stops at a space it
 * has already seen, so a cycle in the space graph ends.
 */
export function spaceReach(
  spaceId: string,
  childSpaceIdsOf: (spaceId: string) => Iterable<string>,
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const child of childSpaceIdsOf(id)) visit(child);
  };
  visit(spaceId);
  return order;
}
