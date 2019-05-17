import { AuthenticationError, UserInputError } from 'apollo-server';
import { GraphQLDate, GraphQLDateTime } from 'graphql-iso-date';
import jwt from 'jsonwebtoken';

export default {
  Date: GraphQLDate,
  DateTime: GraphQLDateTime,
  Availability: {
    member: (availability, _args, { dataSources }) => (
      dataSources.members.fetchMember(availability.member)
    ),
  },
  Member: {
    availabilities: (member, { from, to }, { dataSources }) => (
      dataSources.availabilities.fetchMemberAvailabilities(member.number, from, to)
    ),
  },
  Query: {
    members: (_source, { team }, { dataSources }) => {
      if (team) {
        return dataSources.members.fetchTeamMembers(team);
      }

      return dataSources.members.fetchAllMembers();
    },
    member: (_source, { number }, { dataSources }) => dataSources.members.fetchMember(number),
    membersAvailable: async (_source, { instant }, { dataSources }) => {
      const available = await dataSources.availabilities.fetchMembersAvailable(instant);

      if (available.length === 0) {
        return [];
      }

      return dataSources.members.fetchMembers(available);
    },
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
    setAvailabilities: async (_source, { memberNumber, availabilities }, { dataSources }) => {
      const member = await dataSources.members.fetchMember(memberNumber);

      if (!member) {
        throw new UserInputError('Could not find member');
      }

      await dataSources.availabilities.setAvailabilities(memberNumber, availabilities);

      return true;
    },
  },
};
