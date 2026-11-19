import { z } from "zod";

export const bbDesktopEnvironmentSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    color: z.enum(["blue", "green", "orange", "purple", "yellow", "pink"]),
    kind: z.enum(["local", "ssh"]),
    destination: z.string().min(1).nullable(),
  })
  .strict();
export type BbDesktopEnvironment = z.infer<typeof bbDesktopEnvironmentSchema>;

export type BbDesktopEnvironmentChangeHandler = (
  environment: BbDesktopEnvironment | null,
) => void;

export const bbDesktopEnvironmentTransferRequestSchema = z
  .object({
    path: z.string().min(1),
    maxUploadBytes: z.number().int().nonnegative(),
  })
  .strict();
export type BbDesktopEnvironmentTransferRequest = z.infer<
  typeof bbDesktopEnvironmentTransferRequestSchema
>;

export const bbDesktopEnvironmentTransferResultSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("skipped"),
        reason: z.enum([
          "not-a-local-file",
          "not-an-ssh-environment",
          "within-upload-limit",
        ]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("copied"),
        remotePath: z.string().min(1),
        isDirectory: z.boolean(),
        sizeBytes: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("failed"),
        message: z.string().min(1),
      })
      .strict(),
  ],
);
export type BbDesktopEnvironmentTransferResult = z.infer<
  typeof bbDesktopEnvironmentTransferResultSchema
>;
