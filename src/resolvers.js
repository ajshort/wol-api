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
  Query: {
    unit: (_source, { code }, { dataSources }) => dataSources.units.fetchUnit(code),
    units: (_source, { filter }, { dataSources }) => dataSources.units.fetchUnits(filter),
    availableAt: async (_source, { unitCodes, instant }, { dataSources }) => {
      const availabilities = await dataSources.availabilities.fetchAvailableAt(unitCodes, instant || new Date());
      const members = await dataSources.members.fetchMembers(availabilities.map(a => a.member));

      return availabilities
        .map((availability, index) => ({
          availability,
          member: members[index],
          membership: members[index].units.find(x => x.code === availability.unit),
        }))
        .filter(({ membership }) => membership !== undefined);
    },
    member: (_source, { number }, { dataSources }) => dataSources.members.fetchMember(number),
    loggedInMember: (_source, _args, { member }) => member,
    dutyOfficers: (_source, { unitCode, from, to }, { dataSources }) => (
      dataSources.dutyOfficers.fetchDutyOfficers(unitCode, from, to)
    ),
    dutyOfficersAt: (_source, { unit, instant }, { dataSources }) => (
      dataSources.dutyOfficers.fetchDutyOfficersAt(unit, instant || new Date())
    ),
    statistics: (_source, { stormUnitCodes, rescueUnitCodes, start, end }, { dataSources })=> (
      dataSources.availabilities.fetchStatistics(stormUnitCodes, rescueUnitCodes, start, end, dataSources.members)
    ),
  },
  Unit: {
    members: (unit, { filter }, { dataSources }) => (
      dataSources.members.fetchAllMembers({ ...filter, unitsAny: [unit.code] })
    ),
    membersWithAvailabilities: async (unit, { start, end, filter }, { dataSources }) => {
      const members = await dataSources.members.fetchAllMembers({ ...filter, unitsAny: [unit.code] });
      const numbers = members.map(member => member.number);
      const availabilities = await dataSources.availabilities.fetchMembersAvailabilities(unit.code, numbers, start, end);

      return members.map(member => ({
        member,
        availabilities: availabilities.filter(avail => avail.member === member.number),
        membership: member.units.find(x => x.code === unit.code),
      }));
    },
  },
  Member: {
    availabilities: (member, { unitCode, start, end }, { dataSources }) => (
      dataSources.availabilities.fetchMemberAvailabilities(unitCode, member.number, start, end)
    )
  },
  Mutation: {
    login: async (_source, { memberNumber, password }, { dataSources }) => {
      const member = await dataSources.members.authenticateMember(memberNumber, password);

      if (!member) {
        throw new AuthenticationError('Could not login');
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
      const { start, end, unitCode, memberNumber, availabilities } = args;

      // Check permissions.
      const member = await dataSources.members.fetchMember(memberNumber);

      if (!member) {
        throw new UserInputError('Could not find member');
      }

      const editorMembership = me.units.find(unit => unit.code === unitCode);
      const targetMembership = member.units.find(unit => unit.code === unitCode);

      if (!editorMembership || !targetMembership) {
        throw new UserInputError('Could not find members in unit');
      }

      if (member.number !== me.number) {
        switch (editorMembership.permission) {
          case 'EDIT_UNIT':
            break;

          case 'EDIT_TEAM':
            if (editorMembership.team !== targetMembership.team) {
              throw new ForbiddenError('Not allowed to manage that team\'s availability');
            }
            break;

          default:
            throw new ForbiddenError('Not allowed to manage that member\'s availability');
        }
      }

      const merged = availabilities.map(availability => ({
        member: memberNumber, unit: unitCode, ...availability
      }));

      // Make sure all availabilities are within the interval.
      for (const availability of merged) {
        const startInvalid = availability.start >= end || availability.start < start;
        const endInvalid = availability.end > end || availability.end <= start;

        if (startInvalid || endInvalid) {
          throw new UserInputError('Availability is not between start and end');
        }
      }

      await dataSources.availabilities.setAvailabilities(unitCode, memberNumber, start, end, merged);

      return dataSources.availabilities.fetchMemberAvailabilities(unitCode, memberNumber, start, end)
    },
    setDefaultAvailability: async (_source, args, { dataSources, member: me }) => {
      const { memberNumber, start, availabilities } = args;

      // // Check permissions.
      // const member = await dataSources.members.fetchMember(memberNumber);

      // if (!member) {
      //   throw new UserInputError('Could not find member');
      // }

      // const editorMembership = me.units.find(unit => unit.code === unitCode);
      // const targetMembership = member.units.find(unit => unit.code === unitCode);

      // if (!editorMembership || !targetMembership) {
      //   throw new UserInputError('Could not find members in unit');
      // }

      // if (member.number !== me.number) {
      //   switch (editorMembership.permission) {
      //     case 'EDIT_UNIT':
      //       break;

      //     case 'EDIT_TEAM':
      //       if (editorMembership.team !== targetMembership.team) {
      //         throw new ForbiddenError('Not allowed to manage that team\'s availability');
      //       }
      //       break;

      //     default:
      //       throw new ForbiddenError('Not allowed to manage that member\'s availability');
      //   }
      // }

      await dataSources.availabilities.setDefaultAvailabilities(memberNumber, start, availabilities);

      return true;
    },
    applyDefaultAvailability: async (_source, args, { dataSources, member: me }) => {
      const { unitCode, memberNumber, start } = args;
      const target = await dataSources.members.fetchMember(memberNumber);

      if (!target) {
        throw new UserInputError('Could not find member');
      }

      // if (target.number !== me.number) {
      //   switch (me.permission) {
      //     case 'EDIT_UNIT':
      //       break;

      //     case 'EDIT_TEAM':
      //       if (target.team !== me.team) {
      //         throw new ForbiddenError('Not allowed to manage that team\'s availability');
      //       }
      //       break;

      //     case 'EDIT_SELF':
      //       throw new ForbiddenError('Not allowed to manage that member\'s availability');
      //   }
      // }

      // We apply for a week.
      const end = new Date(start.valueOf());
      end.setDate(end.getDate() + 7);

      await dataSources.availabilities.applyDefaultAvailability(unitCode, memberNumber, start, end);

      return true;
    },
    setDutyOfficer: async (_source, args, { dataSources, member }) => {
      const { unitCode, shift, from, to } = args;
      const { dutyOfficers, members } = dataSources;

      // if (member.permission !== 'EDIT_UNIT' && member.permission !== 'EDIT_TEAM') {
      //   throw new ForbiddenError('Not allowed to edit duty officer');
      // }

      if (shift !== 'DAY' && shift !== 'NIGHT') {
        throw new UserInputError('Invalid shift');
      }

      if (args.memberNumber !== null && !(await members.fetchMember(args.memberNumber))) {
        throw new UserInputError('Could not find member');
      }

      if (from >= to) {
        throw new UserInputError('Invalid date range');
      }

      await dutyOfficers.setDutyOfficer(unitCode, shift, args.memberNumber, from, to);

      return true;
    },
  },
};
