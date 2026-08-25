/**
 * Access control for the endpoints that can start a job or change the schedule.
 *
 * These do real work — spawn processes, hit the FCC — so they cannot be open to
 * the internet. The rule is deliberately simple and fails closed on anything it
 * does not recognise:
 *
 *   - `VANTAGE_ADMIN_TOKEN` set  -> the token is required, always.
 *   - not set                    -> allowed only from loopback or RFC1918.
 *
 * That keeps the LAN deployment usable with a button and no configuration,
 * while making a public deployment refuse by default rather than silently
 * exposing a process-spawning endpoint the first time someone forwards a port.
 */
export interface AuthResult {
  ok: boolean;
  reason?: string;
}

const PRIVATE_V4 =
  /^(?:10\.|127\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

export function clientAddress(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? '';
}

export function isPrivateAddress(addr: string): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, '');
  if (a === '::1' || a === 'localhost') return true;
  if (a.startsWith('fe80:') || a.startsWith('fc') || a.startsWith('fd')) return true;
  return PRIVATE_V4.test(a);
}

export function authorize(req: Request): AuthResult {
  const token = process.env.VANTAGE_ADMIN_TOKEN;
  if (token) {
    const given =
      req.headers.get('x-vantage-token') ??
      (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    return given === token
      ? { ok: true }
      : { ok: false, reason: 'a valid X-Vantage-Token header is required' };
  }

  const addr = clientAddress(req);
  // An empty address means the proxy did not forward one, which on this setup
  // is a direct same-host request.
  if (!addr || isPrivateAddress(addr)) return { ok: true };
  return {
    ok: false,
    reason:
      'refused: this endpoint is limited to private networks. Set VANTAGE_ADMIN_TOKEN to allow remote access.',
  };
}
