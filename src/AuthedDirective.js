const { AuthenticationError, SchemaDirectiveVisitor } = require('apollo-server-micro');
const { defaultFieldResolver } = require('graphql');

class AuthedDirective extends SchemaDirectiveVisitor {
  visitFieldDefinition(field) {
    const resolve = field.resolve || defaultFieldResolver;

    field.resolve = (source, args, context, info) => {
      if (!context.member) {
        throw new AuthenticationError('You must be logged in');
      }

      return resolve.apply(this, [source, args, context, info]);
    };
  }
}

module.exports = AuthedDirective;
