const { ApolloServer, AuthenticationError, gql } = require('apollo-server-micro');
const { readFileSync } = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('micro-cors')();
const { MongoClient } = require('mongodb');

const AuthedDirective = require('./AuthedDirective');
const AvailabilitiesDb = require('./datasources/AvailabilitiesDb');
const DutyOfficersDb = require('./datasources/DutyOfficersDb');
const MembersDb = require('./datasources/MembersDb');
const RosterDb = require('./datasources/RosterDb');
const resolvers = require('./resolvers');

require('dotenv').config();

const schema = readFileSync(path.join(__dirname, '/schema.gql'), 'utf-8');
const typeDefs = gql(schema);

const mongo = new MongoClient(process.env.MONGODB_URL, {
  reconnectTries: 3,
  reconnectInterval: 500,
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const database = mongo.connect().then(connection => connection.db(process.env.MONGODB_DB));

const availabilitiesDb = new AvailabilitiesDb(mongo, database);
const dutyOfficersDb = new DutyOfficersDb(mongo, database);
const membersDb = new MembersDb(database);
const rosterDb = new RosterDb(database);

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
      const member = await membersDb.fetchMember(payload.context.member.number);

      return { member, ...context };
    } catch (err) {
      throw new AuthenticationError('Invalid token');
    }
  },
  schemaDirectives: {
    authed: AuthedDirective,
  },
  dataSources: () => ({
    availabilities: availabilitiesDb,
    dutyOfficers: dutyOfficersDb,
    members: membersDb,
    roster: rosterDb,
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
