/**
 * Use the stored thread title when available. If it's missing, build one from the other
 * participants' names, which is common for one-to-one chats.
 *
 * @param originalTitle - The raw title from the database
 * @param participants - List of participant names
 * @param myNames - List of user's own names (identities)
 * @returns The inferred title
 */
export function inferThreadTitle(
  originalTitle: string | null | undefined,
  participants: string[],
  myNames: string[],
): string {
  let title = originalTitle;

  if (!title || title === 'Unknown' || title.trim() === '') {
    // Filter out myself
    const others = participants.filter((p) => !myNames.includes(p));

    if (others.length === 0) {
      // If only my names remain, this is a thread with myself.
      title = `${myNames[0] || 'Me'} (You)`;
    } else {
      title = others.join(', ');
    }
  }

  return title || 'Unknown';
}
