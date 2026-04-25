export function isTokenExpired(expiresAt, now = Date.now()) {
  return expiresAt < now - 30000;
}

export function validateToken(token, now = Date.now()) {
  if (!token || typeof token.expiresAt !== "number") {
    return false;
  }
  return !isTokenExpired(token.expiresAt, now);
}
