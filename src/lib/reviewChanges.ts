// Whether a client reviewing a document, image or page has changes to send. It
// decides the one button they see (Derek, 2026-09-15): Approve while there is
// nothing to change, Submit changes once they comment or edit. The review page
// and clientPublish both use it, so the button and the server always agree.

export type ChangeComment = { fromClient: boolean; completedAt?: string | null; createdAt: string; pin?: { fileId: string } | null };

/** The client's own open comments on what is under review now. A pin counts when
 *  it sits on a file of the newest version; a comment without a pin counts when it
 *  was written after that version was shared, so notes left on version 1 never
 *  stop the client approving version 2. Resolved comments never count. */
export function openClientComments<C extends ChangeComment>(comments: C[], newestFileIds: string[], sharedAt: string | null): C[] {
  const since = sharedAt ? Date.parse(sharedAt) : null;
  return comments.filter((c) => {
    if (!c.fromClient || c.completedAt) return false;
    if (c.pin) return newestFileIds.includes(c.pin.fileId);
    return since === null || Date.parse(c.createdAt) >= since;
  });
}
