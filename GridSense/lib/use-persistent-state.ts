"use client";

import { useEffect, useState } from "react";

type InitialValue<T> = T | (() => T);

function resolveInitialValue<T>(initialValue: InitialValue<T>) {
  return typeof initialValue === "function" ? (initialValue as () => T)() : initialValue;
}

export function usePersistentState<T>(key: string, initialValue: InitialValue<T>) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") {
      return resolveInitialValue(initialValue);
    }

    try {
      const storedValue = window.localStorage.getItem(key);
      if (storedValue === null) {
        return resolveInitialValue(initialValue);
      }

      return JSON.parse(storedValue) as T;
    } catch {
      return resolveInitialValue(initialValue);
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage quota and serialization issues.
    }
  }, [key, value]);

  return [value, setValue] as const;
}