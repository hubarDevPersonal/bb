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
