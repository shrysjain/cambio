/** Slot coordinates stay anchored even when a hand gains or loses cards. */
export function handPosition(slot: number, opposite = false) {
  const row = slot < 4 ? Math.floor(slot / 2) : (slot - 4) % 2;
  const column = slot < 4 ? slot % 2 : Math.floor((slot - 4) / 2) + 2;
  return opposite ? { row: 1 - row, column: 1 - column } : { row, column };
}

export const handColumns = (slots: number) => Math.max(2, Math.ceil(slots / 2));
