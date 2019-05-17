import { ApolloServer, gql } from 'apollo-server';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';
import path from 'path';

import MembersDatabase from './datasources/MembersDatabase';
import resolvers from './resolvers';

dotenv.config();

const schema = readFileSync(path.join(__dirname, 'schema.gql'), 'utf-8');
const typeDefs = gql(schema);

const mongo = new MongoClient(process.env.MONGODB_URL, { useNewUrlParser: true });
const db = process.env.MONGODB_DB;

const server = new ApolloServer({
  typeDefs,
  resolvers,
  dataSources: () => ({
    members: new MembersDatabase(mongo, db),
  }),
});

export default server;
