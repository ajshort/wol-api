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
  };
}

class MembersDb extends DataSource {
  constructor(db) {
    super();

    this.collection = db.then(connection => connection.collection('members'));
    this.loader = new DataLoader(keys => this.fetchMembers(keys));
  }

  fetchAllMembers() {
    return this.collection.then(members => members.find().map(transformMember).toArray());
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

  fetchTeams() {
    return this.collection.then(collection => collection.distinct('Team'));
  }
}

module.exports = MembersDb;
