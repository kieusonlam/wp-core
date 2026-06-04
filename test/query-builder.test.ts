import { describe, expect, it, beforeAll, vi } from 'vitest';
import { Sequelize, type FindOptions } from 'sequelize';
import mysql2 from 'mysql2';
import { registerModels, getModels } from '../src/models/register.js';
import { setConnection, getConnection, type WpConnection } from '../src/db.js';
import { Post, Op } from '../src/index.js';

// Dựng connection thủ công thay vì connect(): connect() dùng require('./models/
// register.js') (lazy CJS) chỉ resolve sau khi tsup build, không chạy được khi
// vitest đọc thẳng TS. Sequelize không mở kết nối tới khi chạy query nên dựng
// instance + registerModels là đủ để introspect query offline (không cần MySQL).
beforeAll(() => {
  const sequelize = new Sequelize({
    dialect: 'mysql',
    dialectModule: mysql2,
    database: 'test',
    username: 'test',
    password: 'test',
    logging: false,
    define: { timestamps: false, freezeTableName: true, underscored: false },
  });
  const conn: WpConnection = {
    sequelize,
    prefix: 'wp_',
    readOnly: false,
    table: (n) => `wp_${n}`,
    assertWritable() {},
    close: async () => {
      await sequelize.close();
    },
  };
  registerModels(conn);
  setConnection(conn);
});

// buildFindOptions() là protected — cast để đọc `where` sinh ra.
function whereOf(q: unknown): Record<string, Record<symbol, unknown>> {
  const opts = (q as { buildFindOptions(): FindOptions }).buildFindOptions();
  return opts.where as Record<string, Record<symbol, unknown>>;
}

describe('whereIn / whereNotIn', () => {
  it('whereIn → Op.in', () => {
    const w = whereOf(Post.query().whereIn('ID', [1, 2, 3]));
    expect(w.ID[Op.in]).toEqual([1, 2, 3]);
  });

  it('whereIn([]) → IN rỗng (khớp không gì)', () => {
    const w = whereOf(Post.query().whereIn('ID', []));
    expect(w.ID[Op.in]).toEqual([]);
  });

  it('whereNotIn → Op.notIn', () => {
    const w = whereOf(Post.query().whereNotIn('post_status', ['trash', 'auto-draft']));
    expect(w.post_status[Op.notIn]).toEqual(['trash', 'auto-draft']);
  });

  it('whereNotIn([]) → no-op (không thêm điều kiện)', () => {
    const w = whereOf(Post.query().whereNotIn('ID', []));
    expect(w.ID).toBeUndefined();
  });

  it('Op re-export khớp instance models (điều kiện không bị bỏ)', () => {
    const w = whereOf(Post.query().where({ ID: { [Op.gt]: 5 } }));
    expect(w.ID[Op.gt]).toBe(5);
  });
});

describe('hasMeta compose với withMeta (regression)', () => {
  it('giữ eager-load meta (separate), lọc qua ID-subquery chứ không join alias meta', () => {
    const q = Post.query().withMeta().hasMeta('_stock_status', 'instock');
    const opts = (q as unknown as { buildFindOptions(): FindOptions }).buildFindOptions();
    const includes = (opts.include ?? []) as Array<{ as?: string; separate?: boolean; where?: unknown }>;
    const metaIncludes = includes.filter((i) => i.as === 'meta');
    // chỉ còn include 'meta' của withMeta (separate:true), KHÔNG có include lọc kèm where
    expect(metaIncludes).toHaveLength(1);
    expect(metaIncludes[0].separate).toBe(true);
    expect(metaIncludes.some((i) => i.where)).toBe(false);
    // filter chuyển vào where dưới dạng Op.and
    const and = (opts.where as Record<symbol, unknown>)[Op.and];
    expect(Array.isArray(and)).toBe(true);
  });
});

describe('count() distinct (regression: eager JOIN không làm phồng total)', () => {
  it('truyền distinct:true cho Model.count → COUNT(DISTINCT ID), không đếm theo dòng JOIN', async () => {
    const PostModel = getModels(getConnection()).Post;
    const spy = vi.spyOn(PostModel, 'count').mockResolvedValue(7 as never);
    const n = await Post.query().withTaxonomies(['category']).count();
    expect(n).toBe(7);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][0] as { distinct?: boolean }).distinct).toBe(true);
    spy.mockRestore();
  });
});
