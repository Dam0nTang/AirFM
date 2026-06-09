export function isBenignPlaybackInterruption(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false;
  }

  return error.name === "AbortError" || /interrupted/i.test(error.message);
}

export function isUnsupportedPlaybackSource(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false;
  }

  return error.name === "NotSupportedError" || /no supported sources|not supported/i.test(error.message);
}
