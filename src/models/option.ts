/**
 * `Option` — WP's site-wide settings table (`wp_options`).
 *
 * API:
 *   - `Option.get(name)`           → value (PHP-unserialized)
 *   - `Option.add(name, value)`    → INSERT, throws if name already exists
 *   - `Option.set(name, value)`    → UPSERT
 *   - `Option.delete(name)`        → DELETE by name
 *   - `Option.asArray(names?)`     → grab many at once, returns `Record<name, value>`
 */

import { Op, type Transaction } from 'sequelize';
import { getConnection, type WpConnection } from '../db.js';
import { getModels } from './register.js';
import { maybeSerialize, maybeUnserialize } from '../meta/serialization.js';
import type { MetaValue } from '../types.js';

export class Option {
  static async get(name: string, connection?: WpConnection): Promise<MetaValue | undefined> {
    const conn = connection ?? getConnection();
    const { Option: OptionModel } = getModels(conn);
    const row = await OptionModel.findOne({ where: { option_name: name } });
    if (!row) return undefined;
    const raw = row.get('option_value');
    return typeof raw === 'string' ? maybeUnserialize(raw) : (raw as MetaValue);
  }

  static async add(
    name: string,
    value: MetaValue,
    options: { autoload?: 'yes' | 'no'; transaction?: Transaction; connection?: WpConnection } = {},
  ): Promise<void> {
    const conn = options.connection ?? getConnection();
    conn.assertWritable('Option.add');
    const { Option: OptionModel } = getModels(conn);
    await OptionModel.create(
      {
        option_name: name,
        option_value: maybeSerialize(value),
        autoload: options.autoload ?? 'yes',
      },
      { transaction: options.transaction },
    );
  }

  static async set(
    name: string,
    value: MetaValue,
    options: { autoload?: 'yes' | 'no'; transaction?: Transaction; connection?: WpConnection } = {},
  ): Promise<void> {
    const conn = options.connection ?? getConnection();
    conn.assertWritable('Option.set');
    const { Option: OptionModel } = getModels(conn);
    const existing = await OptionModel.findOne({
      where: { option_name: name },
      transaction: options.transaction,
    });
    if (existing) {
      existing.set('option_value', maybeSerialize(value));
      if (options.autoload) existing.set('autoload', options.autoload);
      await existing.save({ transaction: options.transaction });
    } else {
      await Option.add(name, value, options);
    }
  }

  static async delete(name: string, connection?: WpConnection): Promise<number> {
    const conn = connection ?? getConnection();
    conn.assertWritable('Option.delete');
    const { Option: OptionModel } = getModels(conn);
    return OptionModel.destroy({ where: { option_name: name } });
  }

  /**
   * Bulk-load options. Pass a list of names to restrict, or omit to load all
   * autoloaded options.
   */
  static async asArray(
    names?: string[],
    connection?: WpConnection,
  ): Promise<Record<string, MetaValue>> {
    const conn = connection ?? getConnection();
    const { Option: OptionModel } = getModels(conn);
    const rows = await OptionModel.findAll({
      where: names && names.length > 0 ? { option_name: { [Op.in]: names } } : { autoload: 'yes' },
    });
    const out: Record<string, MetaValue> = {};
    for (const row of rows) {
      const k = row.get('option_name') as string;
      const raw = row.get('option_value');
      out[k] = typeof raw === 'string' ? maybeUnserialize(raw) : (raw as MetaValue);
    }
    return out;
  }
}
