import { GraphQLDate, GraphQLDateTime } from 'graphql-iso-date';

export default {
  Date: GraphQLDate,
  DateTime: GraphQLDateTime,
  Query: {
    members: (_obj, _args, { dataSources }) => dataSources.members.fetchMembers(),
    member: (_obj, { number }, { dataSources }) => dataSources.members.fetchMember(number),
    teams: (_obj, _args, { dataSources }) => dataSources.members.fetchTeams(),
  },
};
