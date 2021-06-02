const { AuthenticationError, ForbiddenError, UserInputError } = require('apollo-server-micro');
const axios = require('axios').default;
const axiosCookieJarSupport = require('axios-cookiejar-support').default;
const cheerio = require('cheerio');
const decodeHTML = require('decode-html');
const querystring = require('querystring');
const { CookieJar } = require('tough-cookie');
const { GraphQLDate, GraphQLDateTime } = require('graphql-iso-date');
const _ = require('lodash');
const jwt = require('jsonwebtoken');

axiosCookieJarSupport(axios);

/**
 * Authenticates with Beacon login details, returns true on success.
 */
async function authenticateWithBeacon(username, password) {
  const BEACON_URL = 'https://beacon.ses.nsw.gov.au';
  const IDENTITY_URL = 'https://identity.ses.nsw.gov.au';

  const jar = new CookieJar();
  const opts = { withCredentials: true, jar };

  const extractModel = (res) => {
    return JSON.parse(decodeHTML(cheerio.load(res.data)('#modelJson').html()));
  };

  const { loginUrl, antiForgery } = extractModel(await axios.get(BEACON_URL, opts));

  if (!loginUrl) {
    return false;
  }

  const data = {
    username,
    password,
    [antiForgery.name]: antiForgery.value,
  };

  const res = await axios.post(IDENTITY_URL + loginUrl, querystring.stringify(data), opts);
  const model = extractModel(res);

  if (!model || model.errorMessage) {
    return false;
  }

  return true;
}

module.exports = {
  Date: GraphQLDate,
  DateTime: GraphQLDateTime,
  DutyOfficer: {
    member: (dutyOfficer, _args, { dataSources }) => (
      dataSources.members.fetchMember(dutyOfficer.member)
    ),
  },
  AvailabilityInterval: {
    member: (availability, _args, { dataSources }) => (
      dataSources.members.fetchMember(availability.member)
    ),
  },
  Member: {
    availabilities: (member, { start, end }, { dataSources }) => (
      dataSources.availabilities.fetchMemberAvailabilities(member.number, start, end)
    ),
  },
  MemberAvailabilitySum: {
    member: (sum, _args, { dataSources }) => (
      dataSources.members.fetchMember(sum.member)
    ),
  },
  Query: {
    members: (_source, { filter }, { dataSources }) => dataSources.members.fetchAllMembers(filter),
    member: (_source, { number }, { dataSources }) => dataSources.members.fetchMember(number),
    loggedInMember: (_source, _args, { member }) => member,
    availableAt: async (_source, { instant, filter }, { dataSources }) => {
      let members = undefined;

      if (filter) {
        members = await dataSources.members
          .fetchAllMembers(filter)
          .then(records => records.map(member => member.number));
      }

      return await dataSources.availabilities.fetchAvailableAt(instant || new Date(), members);
    },
    teams: (_source, args, { dataSources }) => dataSources.members.fetchTeams(args.unit),
    dutyOfficers: (_source, args, { dataSources }) => (
      dataSources.dutyOfficers.fetchDutyOfficers(args.from, args.to)
    ),
    dutyOfficersAt: (_source, { instant }, { dataSources }) => (
      dataSources.dutyOfficers.fetchDutyOfficersAt(instant || new Date())
    ),
    statistics: (_source, { start, end, unit }, { dataSources })=> (
      dataSources.availabilities.fetchStatistics(start, end, unit, dataSources.members)
    ),
    qualifications: (_source, _args, { dataSources }) => dataSources.members.fetchQualifications(),
  },
  Mutation: {
    login: async (_source, { memberNumber, password }, { dataSources }) => {
      if (!await authenticateWithBeacon(memberNumber, password)) {
        throw new AuthenticationError('Incorrect login details')
      }

      const member = await dataSources.members.fetchMember(memberNumber);

      if (!member) {
        throw new AuthenticationError('Could not find logged in member');
      }

      const token = jwt.sign({
        iss: 'wol-availability',
        sub: member.number,
        aud: ['all'],
        iat: Date.now(),
        context: {
          member: {
            number: member.number,
            fullName: member.fullName,
          },
          permission: member.permission,
        },
      }, process.env.JWT_SECRET);

      return { token, member };
    },
    setAvailabilities: async (_source, args, { dataSources, member: me }) => {
      const { start, end, availabilities } = args;

      const memberNumbers = availabilities.map(entry => entry.memberNumber);
      const members = await dataSources.members.fetchMembers(memberNumbers);

      // Check permissions.
      for (const target of members) {
        if (!target) {
          throw new UserInputError('Could not find member');
        }

        if (target.number !== me.number) {
          switch (me.permission) {
            case 'EDIT_UNIT':
              break;

            case 'EDIT_TEAM':
              if (target.team !== me.team) {
                throw new ForbiddenError('Not allowed to manage that team\'s availability');
              }
              break;

            case 'EDIT_SELF':
              throw new ForbiddenError('Not allowed to manage that member\'s availability');
          }
        }
      }

      const merged = availabilities.map(
        ({ memberNumber, availabilities }) => availabilities.map(availability => ({
          member: memberNumber, ...availability
        }))
      ).flat();

      // Make sure all availabilities are within the interval.
      for (const availability of merged) {
        const startInvalid = availability.start >= end || availability.start < start;
        const endInvalid = availability.end > end || availability.end <= start;

        if (startInvalid || endInvalid) {
          throw new UserInputError('Availability is not between start and end');
        }
      }

      await dataSources.availabilities.setAvailabilities(start, end, memberNumbers, merged);

      return dataSources.availabilities.fetchMembersAvailabilities(memberNumbers, start, end);
    },
    setDefaultAvailability: async (_source, args, { dataSources, member: me }) => {
      const { memberNumber, start, availabilities } = args;
      const target = await dataSources.members.fetchMember(memberNumber);

      if (!target) {
        throw new UserInputError('Could not find member');
      }

      if (target.number !== me.number) {
        switch (me.permission) {
          case 'EDIT_UNIT':
            break;

          case 'EDIT_TEAM':
            if (target.team !== me.team) {
              throw new ForbiddenError('Not allowed to manage that team\'s availability');
            }
            break;

          case 'EDIT_SELF':
            throw new ForbiddenError('Not allowed to manage that member\'s availability');
        }
      }

      await dataSources.availabilities.setDefaultAvailabilities(memberNumber, start, availabilities);

      return true;
    },
    applyDefaultAvailability: async (_source, args, { dataSources, member: me }) => {
      const { memberNumber, start } = args;
      const target = await dataSources.members.fetchMember(memberNumber);

      if (!target) {
        throw new UserInputError('Could not find member');
      }

      if (target.number !== me.number) {
        switch (me.permission) {
          case 'EDIT_UNIT':
            break;

          case 'EDIT_TEAM':
            if (target.team !== me.team) {
              throw new ForbiddenError('Not allowed to manage that team\'s availability');
            }
            break;

          case 'EDIT_SELF':
            throw new ForbiddenError('Not allowed to manage that member\'s availability');
        }
      }

      // We apply for a week.
      const end = new Date(start.valueOf());
      end.setDate(end.getDate() + 7);

      await dataSources.availabilities.applyDefaultAvailability(memberNumber, start, end);

      return true;
    },
    setDutyOfficer: async (_source, args, { dataSources, member }) => {
      const { shift, from, to } = args;
      const { dutyOfficers, members } = dataSources;

      if (member.permission !== 'EDIT_UNIT' && member.permission !== 'EDIT_TEAM') {
        throw new ForbiddenError('Not allowed to edit duty officer');
      }

      if (shift !== 'DAY' && shift !== 'NIGHT') {
        throw new UserInputError('Invalid shift');
      }

      if (args.member !== null && !(await members.fetchMember(args.member))) {
        throw new UserInputError('Could not find member');
      }

      if (from >= to) {
        throw new UserInputError('Invalid date range');
      }

      await dutyOfficers.setDutyOfficer(shift, args.member, from, to);

      return true;
    },
  },
};
