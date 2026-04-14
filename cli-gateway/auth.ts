const API_KEY = process.env.CLI_GATEWAY_KEY || "";

export function verifyAuth(req: Request | { headers: { get(name: string): string | null } }): boolean {
  if (!API_KEY) return true; // no key configured = open (dev mode)
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${API_KEY}`;
}
