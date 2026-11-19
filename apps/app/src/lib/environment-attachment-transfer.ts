import type { PromptDraftAttachment } from "@bb/client-core";
import type { BbDesktopApi } from "@bb/desktop-contract";
import { PROMPT_ATTACHMENT_MAX_BYTES } from "@bb/domain";
import { getBbDesktopInfo } from "./bb-desktop";

const DIRECTORY_MIME_TYPE = "inode/directory";

export type TransferFileToEnvironment = NonNullable<
  BbDesktopApi["transferFileToEnvironment"]
>;

export class EnvironmentTransferError extends Error {}

export function desktopEnvironmentTransfer(): TransferFileToEnvironment | null {
  return getBbDesktopInfo()?.transferFileToEnvironment ?? null;
}

export async function uploadOrTransferAttachment({
  file,
  upload,
  transfer = desktopEnvironmentTransfer(),
}: {
  file: File;
  upload: (file: File) => Promise<PromptDraftAttachment>;
  transfer?: TransferFileToEnvironment | null;
}): Promise<PromptDraftAttachment> {
  if (transfer === null) return upload(file);
  const result = await transfer(file, {
    maxUploadBytes: PROMPT_ATTACHMENT_MAX_BYTES,
  });
  if (result.kind === "skipped") return upload(file);
  if (result.kind === "failed") {
    throw new EnvironmentTransferError(result.message);
  }
  if (result.isDirectory) {
    return {
      type: "localFile",
      path: result.remotePath,
      name: file.name,
      mimeType: DIRECTORY_MIME_TYPE,
    };
  }
  return {
    type: "localFile",
    path: result.remotePath,
    name: file.name,
    ...(file.type.length > 0 ? { mimeType: file.type } : {}),
    sizeBytes: result.sizeBytes ?? file.size,
  };
}
