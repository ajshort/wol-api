const { ApolloServer, AuthenticationError, gql } = require('apollo-server-micro');
const { readFileSync } = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('micro-cors')();
const { MongoClient } = require('mongodb');

const AuthedDirective = require('./AuthedDirective');
const AvailabilitiesDatabase = require('./AvailabilitiesDatabase');
const MembersDatabase = require('./MembersDatabase');
const RosterDatabase = require('./RosterDatabase');
const VehiclesDb = require('./datasources/VehiclesDb');
const resolvers = require('./resolvers');

require('dotenv').config();

const schema = readFileSync(path.join(__dirname, '/schema.gql'), 'utf-8');
const typeDefs = gql(schema);

const mongo = new MongoClient(process.env.MONGODB_URL, { useNewUrlParser: true });
const database = mongo.connect().then(connection => connection.db(process.env.MONGODB_DB));

const membersDatabase = new MembersDatabase(database);
const availabilitiesDatabase = new AvailabilitiesDatabase(database);
const rosterDatabase = new RosterDatabase(database);
const vehiclesDb = new VehiclesDb(database);

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
    availabilities: availabilitiesDatabase,
    members: membersDatabase,
    roster: rosterDatabase,
    vehicles: vehiclesDb,
  }),
  playground: true,
  introspection: true,
});

const handler = server.createHandler();

module.exports = cors((req, res) => {
  if (req.method === 'OPTIONS') {
    res.end();
  } else {
    handler(req, res);
  }
});
