import { describe, expect, test } from "bun:test";
import { MAX_IMAGE_UPLOAD_BYTES, processImageBuffer } from "@/shared/upload";

describe("shared image processing", () => {
  test("rejects image buffers larger than the upload limit before processing", async () => {
    const oversized = Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1);

    await expect(processImageBuffer(oversized)).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
      status: 400,
    });
  });
});
