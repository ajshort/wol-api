const { DataSource } = require('apollo-datasource');
const DataLoader = require('dataloader');
const { Interval, DateTime } = require('luxon');

const PERMISSIONS = ['EDIT_SELF', 'EDIT_TEAM', 'EDIT_UNIT'];

function transformMember({ _id, ...record }) {
  // Get all qualifications which are in date.
  const qualifications = [];

  if (record.qualifications) {
    for (const { startDate, endDate, code } of record.qualifications) {
      const interval = Interval.fromDateTimes(DateTime.fromISO(startDate), DateTime.fromISO(endDate));

      if (interval.contains(DateTime.local())) {
        qualifications.push(code);
      }
    }
  }

  // See if we can find a mobile.
  let mobile = null;

  for (const { type, detail } of record.contactDetails) {
    if (type === 'Personal Mobile Phone' || type === 'Primary Telephone') {
      mobile = detail;
      break;
    }
  }

  // Convert qualifications to enum values.
  return {
    _id,
    number: parseInt(record.id, 10),
    firstName: record.firstName,
    middleName: record.middleName,
    lastName: record.lastName,
    preferredName: record.preferredName,
    fullName: `${record.firstName} ${record.lastName}`,
    qualifications,
    rank: record.ranks.length > 0 ? record.ranks[0] : null,
    mobile,
    units: record.units.map(unit => ({ code: unit.code, name: unit.name, team: null })),
    permission: 'EDIT_SELF',
  };
}

class MembersDb extends DataSource {
  constructor(db) {
    super();

    this.collection = db.then(connection => connection.collection('members'));
    this.loader = new DataLoader(keys => this.fetchMembers(keys));
  }

  fetchAllMembers(filter) {
    return this.collection.then((members) => {
      const where = { };

      if (filter && filter.unit) {
        where['units.code'] = filter.unit;
      }

      if (filter && filter.team) {
        where.Team = filter.team;
      }

      if (filter && filter.qualificationsAny && filter.qualificationsAny.length > 0) {
        where.Quals = { $in: filter.qualificationsAny };
      }

      return members.find(where).map(transformMember).toArray();
    });
  }

  async fetchMembers(numbers) {
    const strings = numbers.map(number => number.toString());
    const members = await this.collection
      .then(collection => collection.find({ id: { $in: strings } }))
      .then(result => result.map(transformMember).toArray());

    // Order members so they're in the same order.
    const result = new Array(numbers.length);

    for (let i = 0; i < numbers.length; ++i) {
      result[i] = members.find(member => member.number === numbers[i]);
    }

    return result;
  }

  fetchTeamMembers(team) {
    return this.collection
      .then(collection => collection.find({ Team: team }))
      .then(members => members.map(transformMember).toArray());
  }

  fetchMember(number) {
    return this.loader.load(number);
  }

  async authenticateMember(number, password) {
    const collection = await this.collection;
    const member = await collection.findOne({ id: number.toString() });

    if (!member) {
      return false;
    }

    if (password !== process.env.TESTING_PASSWORD) {
      return false;
    }

    return transformMember(member);
  }

  fetchTeams(unit) {
    return this.collection.then(collection => (
      collection.distinct('Team', unit !== undefined ? { Unit: unit } : undefined)
    ));
  }
}

module.exports = MembersDb;
