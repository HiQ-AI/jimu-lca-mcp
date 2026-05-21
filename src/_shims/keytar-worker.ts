/**
 * Shim used by wrangler's bundler to replace the real `keytar` module in the
 * Worker. The Worker never calls keychain functions (those live in the CLI /
 * stdio entries only); this shim's `getPassword` always returns null and
 * `setPassword` throws — which auth.ts's try/catch already handles.
 */
export default {
  async getPassword(_service: string, _account: string): Promise<string | null> {
    return null;
  },
  async setPassword(_service: string, _account: string, _password: string): Promise<void> {
    throw new Error("keytar unavailable in Worker runtime");
  },
};
