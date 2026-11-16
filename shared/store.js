// Petit stockage clé/valeur JSON, namespacé par app.
// Les données restent sur l'appareil (localStorage).
export function store(ns) {
  const key = (k) => `toolbox:${ns}:${k}`;
  return {
    get(k, fallback = null) {
      try {
        const raw = localStorage.getItem(key(k));
        return raw === null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(k, value) {
      try { localStorage.setItem(key(k), JSON.stringify(value)); } catch {}
    },
  };
}
