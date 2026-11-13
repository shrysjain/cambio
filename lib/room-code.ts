// Keep existing invitations valid while issuing shorter codes for new rooms.
export const validRoomCode = (code: string) => /^(?:[A-Z0-9]{4}|[A-Z2-9]{10})$/.test(code);
export const normalizeRoomCode = (code: string) => code.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 10);

export function createRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(4))].map(n => alphabet[n % alphabet.length]).join('');
}
