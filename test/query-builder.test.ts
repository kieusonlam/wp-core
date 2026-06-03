import { describe, expect, it, beforeAll } from 'vitest';
import { Sequelize, type FindOptions } from 'sequelize';
import mysql2 from 'mysql2';
import { registerModels } from '../src/models/register.js';
import { setConnection, type WpConnection } from '../src/db.js';
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
