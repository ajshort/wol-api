const { AuthenticationError, ForbiddenError, UserInputError } = require('apollo-server-micro');
const { GraphQLDate, GraphQLDateTime } = require('graphql-iso-date');
const jwt = require('jsonwebtoken');
const moment = require('moment-timezone');

module.exports = {
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
      // Default to the current time.
      if (!instant) {
        instant = moment();
      }

      const available = await dataSources.availabilities.fetchMembersAvailable(instant);

      if (available.length === 0) {
        return [];
      }

      return dataSources.members.fetchMembers(available);
    },
    loggedInMember: (_source, _args, { member }) => member,
    teams: (_source, _args, { dataSources }) => dataSources.members.fetchTeams(),
    shiftTeams: (_source, _args, { dataSources }) => dataSources.roster.fetchShiftTeams('WOL'),
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
    setAvailabilities: async (_source, args, { dataSources, member }) => {
      const { memberNumber, availabilities } = args;
      const target = await dataSources.members.fetchMember(memberNumber);

      if (!target) {
        throw new UserInputError('Could not find member');
      }

      // Ensure that the member has appropriate permissions.
      if (memberNumber !== member.number) {
        switch (member.permission) {
          case 'EDIT_UNIT':
            break;

          case 'EDIT_TEAM':
            if (target.team !== member.team) {
              throw new ForbiddenError('Not allowed to manage that team\'s availability');
            }
            break;

          case 'EDIT_SELF':
          default:
            throw new ForbiddenError('Not allowed to manage that member\'s availability');
        }
      }

      await dataSources.availabilities.setAvailabilities(memberNumber, availabilities);

      return true;
    },
  },
};
