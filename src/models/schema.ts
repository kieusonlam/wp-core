/**
 * Sequelize model definitions for every WordPress core table we touch.
 *
 * We use `sequelize.define()` rather than `sequelize-typescript` decorators
 * because (a) WP column names are fixed and well-known, so the verbose
 * mapping is acceptable, (b) it avoids decorator metadata pitfalls in modern
 * Node, and (c) it keeps the build dependency-light.
 *
 * Each definition is exported as `define<Name>(sequelize, prefix)` so the
 * caller can rebind to a different prefix per connection.
 */

import {
  DataTypes,
  Model,
  type ModelStatic,
  type Sequelize,
} from 'sequelize';

// ----------------------------------------------------------------------------
// Posts
// ----------------------------------------------------------------------------
export interface PostAttrs {
  ID: number;
  post_author: number;
  post_date: string;
  post_date_gmt: string;
  post_content: string;
  post_title: string;
  post_excerpt: string;
  post_status: string;
  comment_status: string;
  ping_status: string;
  post_password: string;
  post_name: string;
  to_ping: string;
  pinged: string;
  post_modified: string;
  post_modified_gmt: string;
  post_content_filtered: string;
  post_parent: number;
  guid: string;
  menu_order: number;
  post_type: string;
  post_mime_type: string;
  comment_count: number;
}

export type PostInstance = Model<PostAttrs, Partial<PostAttrs>> & PostAttrs;

export function definePost(sequelize: Sequelize, prefix: string): ModelStatic<PostInstance> {
  return sequelize.define<PostInstance>(
    'WpPost',
    {
      ID: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      post_author: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      post_date: { type: DataTypes.STRING(19), allowNull: false, defaultValue: '0000-00-00 00:00:00' },
      post_date_gmt: { type: DataTypes.STRING(19), allowNull: false, defaultValue: '0000-00-00 00:00:00' },
      post_content: { type: DataTypes.TEXT('long'), allowNull: false },
      post_title: { type: DataTypes.TEXT, allowNull: false },
      post_excerpt: { type: DataTypes.TEXT, allowNull: false },
      post_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'publish' },
      comment_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'open' },
      ping_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'open' },
      post_password: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      post_name: { type: DataTypes.STRING(200), allowNull: false, defaultValue: '' },
      to_ping: { type: DataTypes.TEXT, allowNull: false },
      pinged: { type: DataTypes.TEXT, allowNull: false },
      post_modified: { type: DataTypes.STRING(19), allowNull: false, defaultValue: '0000-00-00 00:00:00' },
      post_modified_gmt: { type: DataTypes.STRING(19), allowNull: false, defaultValue: '0000-00-00 00:00:00' },
      post_content_filtered: { type: DataTypes.TEXT('long'), allowNull: false },
      post_parent: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      guid: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      menu_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      post_type: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'post' },
      post_mime_type: { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
      comment_count: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    },
    { tableName: `${prefix}posts` },
  );
}

// ----------------------------------------------------------------------------
// Postmeta (also serves as template for usermeta / termmeta / commentmeta)
// ----------------------------------------------------------------------------
export interface MetaAttrs {
  meta_id: number;
  /** FK to posts / users / terms / comments depending on table. */
  object_id: number;
  meta_key: string | null;
  /** Raw value (PHP-serialized for arrays/objects). */
  meta_value: string | null;
}

export type MetaInstance = Model<MetaAttrs, Partial<MetaAttrs>> & MetaAttrs;

function defineMetaTable(
  sequelize: Sequelize,
  modelName: string,
  tableName: string,
  fkColumn: string,
  pkColumn: string,
): ModelStatic<MetaInstance> {
  return sequelize.define<MetaInstance>(
    modelName,
    {
      meta_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
        field: pkColumn,
      },
      object_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
        field: fkColumn,
      },
      meta_key: { type: DataTypes.STRING(255), allowNull: true },
      meta_value: { type: DataTypes.TEXT('long'), allowNull: true },
    },
    { tableName },
  );
}

export const definePostMeta = (s: Sequelize, p: string) =>
  defineMetaTable(s, 'WpPostMeta', `${p}postmeta`, 'post_id', 'meta_id');

export const defineUserMeta = (s: Sequelize, p: string) =>
  defineMetaTable(s, 'WpUserMeta', `${p}usermeta`, 'user_id', 'umeta_id');

export const defineTermMeta = (s: Sequelize, p: string) =>
  defineMetaTable(s, 'WpTermMeta', `${p}termmeta`, 'term_id', 'meta_id');

export const defineCommentMeta = (s: Sequelize, p: string) =>
  defineMetaTable(s, 'WpCommentMeta', `${p}commentmeta`, 'comment_id', 'meta_id');

// ----------------------------------------------------------------------------
// Users
// ----------------------------------------------------------------------------
export interface UserAttrs {
  ID: number;
  user_login: string;
  user_pass: string;
  user_nicename: string;
  user_email: string;
  user_url: string;
  user_registered: string;
  user_activation_key: string;
  user_status: number;
  display_name: string;
}

export type UserInstance = Model<UserAttrs, Partial<UserAttrs>> & UserAttrs;

export function defineUser(sequelize: Sequelize, prefix: string): ModelStatic<UserInstance> {
  return sequelize.define<UserInstance>(
    'WpUser',
    {
      ID: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      user_login: { type: DataTypes.STRING(60), allowNull: false, defaultValue: '' },
      user_pass: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      user_nicename: { type: DataTypes.STRING(50), allowNull: false, defaultValue: '' },
      user_email: { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
      user_url: { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
      user_registered: { type: DataTypes.STRING(19), allowNull: false, defaultValue: '0000-00-00 00:00:00' },
      user_activation_key: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      user_status: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      display_name: { type: DataTypes.STRING(250), allowNull: false, defaultValue: '' },
    },
    { tableName: `${prefix}users` },
  );
}

// ----------------------------------------------------------------------------
// Comments
// ----------------------------------------------------------------------------
export interface CommentAttrs {
  comment_ID: number;
  comment_post_ID: number;
  comment_author: string;
  comment_author_email: string;
  comment_author_url: string;
  comment_author_IP: string;
  comment_date: string;
  comment_date_gmt: string;
  comment_content: string;
  comment_karma: number;
  comment_approved: string;
  comment_agent: string;
  comment_type: string;
  comment_parent: number;
  user_id: number;
}

export type CommentInstance = Model<CommentAttrs, Partial<CommentAttrs>> & CommentAttrs;

export function defineComment(sequelize: Sequelize, prefix: string): ModelStatic<CommentInstance> {
  return sequelize.define<CommentInstance>(
    'WpComment',
    {
      comment_ID: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      comment_post_ID: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      comment_author: { type: DataTypes.TEXT, allowNull: false },
      comment_author_email: { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
      comment_author_url: { type: DataTypes.STRING(200), allowNull: false, defaultValue: '' },
      comment_author_IP: { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
      comment_date: { type: DataTypes.STRING(19), allowNull: false, defaultValue: '0000-00-00 00:00:00' },
      comment_date_gmt: { type: DataTypes.STRING(19), allowNull: false, defaultValue: '0000-00-00 00:00:00' },
      comment_content: { type: DataTypes.TEXT, allowNull: false },
      comment_karma: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      comment_approved: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '1' },
      comment_agent: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      comment_type: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'comment' },
      comment_parent: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    },
    { tableName: `${prefix}comments` },
  );
}

// ----------------------------------------------------------------------------
// Terms + Term Taxonomy + Term Relationships
// ----------------------------------------------------------------------------
export interface TermAttrs {
  term_id: number;
  name: string;
  slug: string;
  term_group: number;
}

export type TermInstance = Model<TermAttrs, Partial<TermAttrs>> & TermAttrs;

export function defineTerm(sequelize: Sequelize, prefix: string): ModelStatic<TermInstance> {
  return sequelize.define<TermInstance>(
    'WpTerm',
    {
      term_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(200), allowNull: false, defaultValue: '' },
      slug: { type: DataTypes.STRING(200), allowNull: false, defaultValue: '' },
      term_group: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    },
    { tableName: `${prefix}terms` },
  );
}

export interface TermTaxonomyAttrs {
  term_taxonomy_id: number;
  term_id: number;
  taxonomy: string;
  description: string;
  parent: number;
  count: number;
}

export type TermTaxonomyInstance = Model<TermTaxonomyAttrs, Partial<TermTaxonomyAttrs>> &
  TermTaxonomyAttrs;

export function defineTermTaxonomy(
  sequelize: Sequelize,
  prefix: string,
): ModelStatic<TermTaxonomyInstance> {
  return sequelize.define<TermTaxonomyInstance>(
    'WpTermTaxonomy',
    {
      term_taxonomy_id: {
        type: DataTypes.BIGINT.UNSIGNED,
        primaryKey: true,
        autoIncrement: true,
      },
      term_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      taxonomy: { type: DataTypes.STRING(32), allowNull: false, defaultValue: '' },
      description: { type: DataTypes.TEXT('long'), allowNull: false },
      parent: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      count: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    },
    { tableName: `${prefix}term_taxonomy` },
  );
}

export interface TermRelationshipAttrs {
  object_id: number;
  term_taxonomy_id: number;
  term_order: number;
}

export type TermRelationshipInstance = Model<
  TermRelationshipAttrs,
  Partial<TermRelationshipAttrs>
> &
  TermRelationshipAttrs;

export function defineTermRelationship(
  sequelize: Sequelize,
  prefix: string,
): ModelStatic<TermRelationshipInstance> {
  return sequelize.define<TermRelationshipInstance>(
    'WpTermRelationship',
    {
      object_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, defaultValue: 0 },
      term_taxonomy_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, defaultValue: 0 },
      term_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { tableName: `${prefix}term_relationships` },
  );
}

// ----------------------------------------------------------------------------
// Options
// ----------------------------------------------------------------------------
export interface OptionAttrs {
  option_id: number;
  option_name: string;
  option_value: string;
  autoload: string;
}

export type OptionInstance = Model<OptionAttrs, Partial<OptionAttrs>> & OptionAttrs;

export function defineOption(sequelize: Sequelize, prefix: string): ModelStatic<OptionInstance> {
  return sequelize.define<OptionInstance>(
    'WpOption',
    {
      option_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      option_name: { type: DataTypes.STRING(191), allowNull: false, defaultValue: '', unique: true },
      option_value: { type: DataTypes.TEXT('long'), allowNull: false },
      autoload: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'yes' },
    },
    { tableName: `${prefix}options` },
  );
}

// ----------------------------------------------------------------------------
// All-models bundle (returned from `register`)
// ----------------------------------------------------------------------------
export interface WpModels {
  Post: ModelStatic<PostInstance>;
  PostMeta: ModelStatic<MetaInstance>;
  User: ModelStatic<UserInstance>;
  UserMeta: ModelStatic<MetaInstance>;
  Comment: ModelStatic<CommentInstance>;
  CommentMeta: ModelStatic<MetaInstance>;
  Term: ModelStatic<TermInstance>;
  TermMeta: ModelStatic<MetaInstance>;
  TermTaxonomy: ModelStatic<TermTaxonomyInstance>;
  TermRelationship: ModelStatic<TermRelationshipInstance>;
  Option: ModelStatic<OptionInstance>;
}
