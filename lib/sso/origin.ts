// Origin of the iNon product app itself (session cookies + OAuth callback).
export function inonProjectOrigin(): string {
  return (
    process.env.INON_SSO_PUBLIC_ORIGIN ??
    (process.env.NODE_ENV === "production"
      ? "https://world.inon.space"
      : "http://localhost:3000")
  );
}

// Origin of the central SSO identity platform.
export function inonSsoOrigin(): string {
  return process.env.INON_SSO_CANONICAL_ORIGIN ?? "https://sso.inon.space";
}

// OAuth issuer advertised by the SSO worker.
export function inonSsoIssuer(): string {
  return (
    process.env.INON_SSO_ISSUER ?? `${inonSsoOrigin()}/api/sso/auth`
  );
}
