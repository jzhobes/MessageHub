/**
 * Infers a display title for a thread.
 * If the title is missing (common in 1:1 chats), it generates one based on participants,
 * excluding the user's own identities.
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
      // Talking to self or only me in list
      title = `${myNames[0] || 'Me'} (You)`;
    } else {
      title = others.join(', ');
    }
  }

  return title || 'Unknown';
}
