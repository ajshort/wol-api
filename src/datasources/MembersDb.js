const { DataSource } = require('apollo-datasource');
const DataLoader = require('dataloader');
const { sha512crypt } = require('sha512crypt-node');

const PERMISSIONS = ['EDIT_SELF', 'EDIT_TEAM', 'EDIT_UNIT'];

function filterNone(value) {
  return value === 'None' ? undefined : value;
}

function transformMember({ _id, ...record }) {
  // Everyone can at least edit their own availability.
  let permission = 'EDIT_SELF';

  if (PERMISSIONS.includes(record.Permission)) {
    permission = record.Permission;
  }

  // The database uses some numbers for driver classification, map them to actual L1-3.
  let driverLevel = null;

  switch (record.DriverClassification) {
    case 2:
      driverLevel = 1;
      break;
    case 3:
    case 4:
      driverLevel = 2;
      break;
    case 5:
    case 6:
      driverLevel = 3;
      break;
  }

  // Convert qualifications to enum values.
  return {
    _id,
    number: parseInt(record.Id, 10),
    permission,
    givenNames: record.Name,
    surname: record.Surname,
    fullName: `${record.Name} ${record.Surname}`,
    mobile: record.Mobile,
    qualifications: [...new Set(record.Quals)],
    rank: filterNone(record.Rank),
    position: filterNone(record.Position),
    team: record.Team,
    unit: record.Unit,
    callsign: record.Callsign,
    driverLevel,
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
        where.Unit = filter.unit;
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
      .then(collection => collection.find({ Id: { $in: strings } }))
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
    const member = await collection.findOne({ Id: number.toString() });

    if (!member) {
      return false;
    }

    // Extract the salt from the password.
    const expected = member.Password;
    const salt = expected.split('$').filter(s => s.length > 0)[1];
    const crypted = sha512crypt(password, salt);

    if (crypted !== expected) {
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
