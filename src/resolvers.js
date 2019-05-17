import { AuthenticationError } from 'apollo-server';
import { GraphQLDate, GraphQLDateTime } from 'graphql-iso-date';
import jwt from 'jsonwebtoken';

export default {
  Date: GraphQLDate,
  DateTime: GraphQLDateTime,
  Query: {
    members: (_source, { team }, { dataSources }) => {
      if (team) {
        return dataSources.members.fetchTeamMembers(team);
      }

      return dataSources.members.fetchMembers();
    },
    member: (_source, { number }, { dataSources }) => dataSources.members.fetchMember(number),
    teams: (_source, _args, { dataSources }) => dataSources.members.fetchTeams(),
  },
  Mutation: {
    login: async (_source, { memberNumber, password }, { dataSources }) => {
      const member = await dataSources.members.authenticateMember(memberNumber, password);

      if (!member) {
        throw new AuthenticationError('Could not login');
      }

      const token = jwt.sign({ number: memberNumber }, process.env.JWT_SECRET);
      return { token, member };
    },
  },
};
