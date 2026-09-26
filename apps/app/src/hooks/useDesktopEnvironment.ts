import { useEffect, useState } from "react";
import type { BbDesktopEnvironment } from "@bb/desktop-contract";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

export function useDesktopEnvironment(): BbDesktopEnvironment | null {
  const [environment, setEnvironment] = useState<BbDesktopEnvironment | null>(
    null,
  );

  useEffect(() => {
    const api = getBbDesktopInfo();
    if (api?.getEnvironment === undefined) {
      return;
    }
    let mounted = true;
    void api
      .getEnvironment()
      .then((current) => {
        if (mounted) setEnvironment(current);
      })
      .catch(() => undefined);
    const unsubscribe = api.onEnvironmentChange?.((next) => {
      setEnvironment(next);
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  return environment;
}
