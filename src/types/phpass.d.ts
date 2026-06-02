/**
 * Minimal type declarations for the `phpass` npm package (no types shipped).
 */
declare module 'phpass' {
  export class PasswordHash {
    constructor(iterations?: number, portable?: boolean);
    checkPassword(
      password: string,
      storedHash: string,
      callback: (err: Error | null, ok: boolean) => void,
    ): void;
    hashPassword(password: string, callback: (err: Error | null, hash: string) => void): void;
  }
  const _default: { PasswordHash: typeof PasswordHash };
  export default _default;
}
