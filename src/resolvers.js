export default {
  Query: {
    members: (_obj, _args, { dataSources }) => dataSources.members.fetchMembers(),
    member: (_obj, { number }, { dataSources }) => dataSources.members.fetchMember(number),
    teams: (_obj, _args, { dataSources }) => dataSources.members.fetchTeams(),
  },
};
