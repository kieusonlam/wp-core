/**
 * Bind every WordPress model to a given connection's Sequelize instance,
 * wire associations, and stash them on the connection for downstream lookup.
 *
 * Called automatically from `connect()` but exported so tests can re-run it
 * (e.g. after swapping in a sandbox DB).
 */

import type { WpConnection } from '../db.js';
import { maybeUnserialize } from '../meta/serialization.js';
import {
  defineComment,
  defineCommentMeta,
  defineOption,
  definePost,
  definePostMeta,
  defineTerm,
  defineTermMeta,
  defineTermRelationship,
  defineTermTaxonomy,
  defineUser,
  defineUserMeta,
  type WpModels,
} from './schema.js';

/** Storage key for per-connection model registry. */
const MODELS_KEY = Symbol.for('@kieusonlam/wp-core/models');

interface ConnectionWithModels extends WpConnection {
  [MODELS_KEY]?: WpModels;
}

/**
 * Define and associate every model on the given connection. Idempotent — if
 * models already exist on the connection, returns them.
 */
export function registerModels(connection: WpConnection): WpModels {
  const c = connection as ConnectionWithModels;
  if (c[MODELS_KEY]) return c[MODELS_KEY];

  const { sequelize, prefix } = connection;

  const Post = definePost(sequelize, prefix);
  const PostMeta = definePostMeta(sequelize, prefix);
  const User = defineUser(sequelize, prefix);
  const UserMeta = defineUserMeta(sequelize, prefix);
  const Comment = defineComment(sequelize, prefix);
  const CommentMeta = defineCommentMeta(sequelize, prefix);
  const Term = defineTerm(sequelize, prefix);
  const TermMeta = defineTermMeta(sequelize, prefix);
  const TermTaxonomy = defineTermTaxonomy(sequelize, prefix);
  const TermRelationship = defineTermRelationship(sequelize, prefix);
  const Option = defineOption(sequelize, prefix);

  // ------------------------------------------------------------------------
  // Associations
  // ------------------------------------------------------------------------
  Post.hasMany(PostMeta, { foreignKey: 'post_id', as: 'meta' });
  PostMeta.belongsTo(Post, { foreignKey: 'post_id', as: 'post' });

  User.hasMany(UserMeta, { foreignKey: 'user_id', as: 'meta' });
  UserMeta.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

  Post.belongsTo(User, { foreignKey: 'post_author', as: 'author' });
  User.hasMany(Post, { foreignKey: 'post_author', as: 'posts' });

  Post.hasMany(Comment, { foreignKey: 'comment_post_ID', as: 'comments' });
  Comment.belongsTo(Post, { foreignKey: 'comment_post_ID', as: 'post' });
  Comment.belongsTo(User, { foreignKey: 'user_id', as: 'author' });
  Comment.hasMany(CommentMeta, { foreignKey: 'comment_id', as: 'meta' });
  CommentMeta.belongsTo(Comment, { foreignKey: 'comment_id', as: 'comment' });

  Term.hasOne(TermTaxonomy, { foreignKey: 'term_id', as: 'taxonomy' });
  TermTaxonomy.belongsTo(Term, { foreignKey: 'term_id', as: 'term' });
  Term.hasMany(TermMeta, { foreignKey: 'term_id', as: 'meta' });
  TermMeta.belongsTo(Term, { foreignKey: 'term_id', as: 'term' });

  // Self-reference for taxonomy hierarchy (categories with parents)
  TermTaxonomy.belongsTo(TermTaxonomy, { foreignKey: 'parent', as: 'parentTaxonomy' });

  // Post <-> Term many-to-many via term_relationships
  Post.belongsToMany(TermTaxonomy, {
    through: { model: TermRelationship, unique: false },
    foreignKey: 'object_id',
    otherKey: 'term_taxonomy_id',
    as: 'taxonomies',
  });
  TermTaxonomy.belongsToMany(Post, {
    through: { model: TermRelationship, unique: false },
    foreignKey: 'term_taxonomy_id',
    otherKey: 'object_id',
    as: 'posts',
  });

  // Self-reference: revisions/attachments use post_parent → post
  Post.hasMany(Post, { foreignKey: 'post_parent', as: 'children' });
  Post.belongsTo(Post, { foreignKey: 'post_parent', as: 'parent' });

  // ------------------------------------------------------------------------
  // Hooks — auto-deserialize PHP-serialized meta on read
  // ------------------------------------------------------------------------
  const metaTables = [PostMeta, UserMeta, CommentMeta, TermMeta];
  for (const M of metaTables) {
    M.addHook('afterFind', (result) => {
      if (!result) return;
      const rows = Array.isArray(result) ? result : [result];
      for (const row of rows) {
        if (!row) continue;
        const raw = row.get('meta_value');
        if (typeof raw === 'string') {
          // Store decoded value on `unserialized` virtual prop (set via dataValues)
          (row as { dataValues: Record<string, unknown> }).dataValues.unserialized =
            maybeUnserialize(raw);
        }
      }
    });
  }

  Option.addHook('afterFind', (result) => {
    if (!result) return;
    const rows = Array.isArray(result) ? result : [result];
    for (const row of rows) {
      if (!row) continue;
      const raw = row.get('option_value');
      if (typeof raw === 'string') {
        (row as { dataValues: Record<string, unknown> }).dataValues.unserialized =
          maybeUnserialize(raw);
      }
    }
  });

  const models: WpModels = {
    Post,
    PostMeta,
    User,
    UserMeta,
    Comment,
    CommentMeta,
    Term,
    TermMeta,
    TermTaxonomy,
    TermRelationship,
    Option,
  };
  c[MODELS_KEY] = models;
  return models;
}

/**
 * Fetch the model registry for a connection. Throws if {@link registerModels}
 * was not yet called.
 */
export function getModels(connection: WpConnection): WpModels {
  const c = connection as ConnectionWithModels;
  if (!c[MODELS_KEY]) {
    throw new Error(
      'Models not registered yet. Call registerModels(connection) (or use connect()).',
    );
  }
  return c[MODELS_KEY];
}
