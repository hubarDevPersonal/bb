import { atom, useAtomValue, useSetAtom } from "jotai";
import { atomFamily } from "jotai-family";

export const threadApplyConflictAtomFamily = atomFamily((_threadId: string) =>
  atom<readonly string[] | null>(null),
);

export function useThreadApplyConflictFiles(
  threadId: string,
): readonly string[] | null {
  return useAtomValue(threadApplyConflictAtomFamily(threadId));
}

export function useSetThreadApplyConflictFiles(threadId: string) {
  return useSetAtom(threadApplyConflictAtomFamily(threadId));
}
