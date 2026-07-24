import { useState, useCallback } from "react";

const STORAGE_KEY = "dzl-favorites";

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // ignore
  }
  return new Set();
}

function save(favs: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...favs]));
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(load);

  const toggle = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      save(next);
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (id: string) => favorites.has(id),
    [favorites],
  );

  return { favorites, toggle, isFavorite };
}
