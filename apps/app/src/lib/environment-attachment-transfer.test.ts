import { describe, expect, it, vi } from "vitest";
import type { PromptDraftAttachment } from "@bb/client-core";
import { PROMPT_ATTACHMENT_MAX_BYTES } from "@bb/domain";
import {
  uploadOrTransferAttachment,
  type TransferFileToEnvironment,
} from "./environment-attachment-transfer";
import { uploadDraftAttachments } from "@/components/thread/embedded-chat/useComposerAttachmentUploads";

const uploaded: PromptDraftAttachment = {
  type: "localFile",
  path: "uploads/notes.txt",
  name: "notes.txt",
  sizeBytes: 5,
};

function transferReturning(
  result: Awaited<ReturnType<TransferFileToEnvironment>>,
) {
  return vi.fn<TransferFileToEnvironment>().mockResolvedValue(result);
}

describe("uploadOrTransferAttachment", () => {
  it("attaches a copied folder by its absolute environment path", async () => {
    const upload = vi.fn<(file: File) => Promise<PromptDraftAttachment>>();
    const transfer = transferReturning({
      kind: "copied",
      remotePath: "/home/artem/bb-drops/20261108-121503-ab12/site",
      isDirectory: true,
      sizeBytes: null,
    });
    const folder = new File([], "site");

    await expect(
      uploadOrTransferAttachment({ file: folder, upload, transfer }),
    ).resolves.toEqual({
      type: "localFile",
      path: "/home/artem/bb-drops/20261108-121503-ab12/site",
      name: "site",
      mimeType: "inode/directory",
    });
    expect(transfer).toHaveBeenCalledWith(folder, {
      maxUploadBytes: PROMPT_ATTACHMENT_MAX_BYTES,
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it("keeps the type and size of a copied large file", async () => {
    const result = await uploadOrTransferAttachment({
      file: new File(["x"], "dump.sql", { type: "application/sql" }),
      upload: vi.fn(),
      transfer: transferReturning({
        kind: "copied",
        remotePath: "/home/artem/bb-drops/s/dump.sql",
        isDirectory: false,
        sizeBytes: 50_000_000,
      }),
    });

    expect(result).toEqual({
      type: "localFile",
      path: "/home/artem/bb-drops/s/dump.sql",
      name: "dump.sql",
      mimeType: "application/sql",
      sizeBytes: 50_000_000,
    });
  });

  it("uploads normally when the desktop skips the file or is not available", async () => {
    const upload = vi.fn(async () => uploaded);
    const file = new File(["notes"], "notes.txt");

    await expect(
      uploadOrTransferAttachment({
        file,
        upload,
        transfer: transferReturning({
          kind: "skipped",
          reason: "within-upload-limit",
        }),
      }),
    ).resolves.toBe(uploaded);
    await expect(
      uploadOrTransferAttachment({ file, upload, transfer: null }),
    ).resolves.toBe(uploaded);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("shows why a copy to the environment failed", async () => {
    const transfer = transferReturning({
      kind: "failed",
      message: "Could not copy to artem@host: rsync exited 23: disk full",
    });

    const result = await uploadDraftAttachments({
      uploads: [{ id: "site", file: new File([], "site") }],
      target: { key: "bottom", addAttachment: vi.fn() },
      upload: (file) =>
        uploadOrTransferAttachment({ file, upload: vi.fn(), transfer }),
      getCurrentTarget: () => ({ key: "bottom", addAttachment: vi.fn() }),
      onUploadSettled: vi.fn(),
    });

    expect(result.failureMessage).toBe(
      "Failed to attach site: Could not copy to artem@host: rsync exited 23: disk full",
    );
  });
});
