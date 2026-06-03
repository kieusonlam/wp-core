import { describe, expect, it } from 'vitest';
import { verify, hashBcrypt } from '../src/auth/phpass.js';

describe('password verify', () => {
  // Format WP ≥ 6.8 ($wp$2y$) — chính là bug đã fix. (phpass $P$ không test ở đây
  // vì hashPhpass của npm phpass rất chậm; path đó không bị đổi bởi fix này.)
  it('WP ≥ 6.8 bcrypt ($wp$2y$) round-trip', async () => {
    const h = await hashBcrypt('Mật khẩu 123!');
    expect(h.startsWith('$wp$2y$')).toBe(true);
    expect(await verify('Mật khẩu 123!', h)).toBe(true);
    expect(await verify('sai-mat-khau', h)).toBe(false);
  });

  it('raw bcrypt $2y$ vẫn verify được', async () => {
    const wp = await hashBcrypt('abc'); // $wp$2y$...
    const raw = wp.slice(3); // $2y$... (không có wrapper $wp) — KHÔNG khớp vì thiếu prehash
    // chỉ kiểm path $2y$ chạy không lỗi (không throw Bad salt length)
    expect(typeof (await verify('abc', raw))).toBe('boolean');
  });

  it('hash rỗng → false', async () => {
    expect(await verify('whatever', '')).toBe(false);
  });
});
