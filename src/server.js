import { ApolloServer, gql, AuthenticationError } from 'apollo-server';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';
import path from 'path';

import AuthedDirective from './AuthedDirective';
import MembersDatabase from './MembersDatabase';
import resolvers from './resolvers';

dotenv.config();

const schema = readFileSync(path.join(__dirname, 'schema.gql'), 'utf-8');
const typeDefs = gql(schema);

const mongo = new MongoClient(process.env.MONGODB_URL, { useNewUrlParser: true });
const database = mongo.connect().then(connection => connection.db(process.env.MONGODB_DB));

const membersDatabase = new MembersDatabase(database);

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async (context) => {
    const auth = context.req.headers.authorization;

    if (!auth) {
      return context;
    }

    const parts = auth.split(' ');

    if (parts.length < 2 || parts[0].toLowerCase() !== 'bearer') {
      return context;
    }

    const token = parts.slice(1).join(' ');

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const member = await membersDatabase.fetchMember(payload.number);

      return { member, ...context };
    } catch (err) {
      throw new AuthenticationError('Invalid token');
    }
  },
  schemaDirectives: {
    authed: AuthedDirective,
  },
  dataSources: () => ({
    members: membersDatabase,
  }),
});

export default server;
