/** Builds a renderer, or returns null (after one warning) when it cannot be made, so the caller can fall back. */
export function tryCreate<T>(create: () => T, warn: (message: string, error: unknown) => void): T | null {
  try {
    return create();
  } catch (error) {
    warn("WebGL people renderer unavailable, falling back to Canvas 2D", error);
    return null;
  }
}
