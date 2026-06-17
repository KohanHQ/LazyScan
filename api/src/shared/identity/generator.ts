import { v7 as uuidv7 } from "uuid";
import { nanoid } from "nanoid";
import type { UUID } from "@/shared/types/id";

export type UUIDv7Generator = () => UUID;
export type DisplayIDGenerator = (size?: number) => string;

const MIN_DISPLAY_ID_LENGTH = 12;

export const generateUUIDv7: UUIDv7Generator = () => uuidv7() as UUID;

export const generateDisplayID: DisplayIDGenerator = (
  size = MIN_DISPLAY_ID_LENGTH,
) => {
  const length = Math.max(MIN_DISPLAY_ID_LENGTH, Math.floor(size));

  return nanoid(length) as string;
};

export const idGenerators = {
  uuidv7: generateUUIDv7,
  displayId: generateDisplayID,
};
