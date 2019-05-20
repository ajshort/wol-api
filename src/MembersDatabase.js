const { DataSource } = require('apollo-datasource');

const PERMISSIONS = ['EDIT_SELF', 'EDIT_TEAM', 'EDIT_UNIT'];

const QUALIFICATIONS = {
  'Chainsaw': 'CHAINSAW_CROSSCUT', // eslint-disable-line quote-props
  'On Land Flood Rescue': 'FLOOD_RESCUE_1',
  'On Water Flood Rescue': 'FLOOD_RESCUE_2',
  'In Water Flood Rescue': 'FLOOD_RESCUE_3',
  'Land Search': 'LAND_SEARCH',
  'Storm Water Damage': 'STORM_WATER_DAMAGE',
  'Vertical Rescue': 'VERTICAL_RESCUE',
};

function transformQualification(qual) {
  if (typeof QUALIFICATIONS[qual] === 'undefined') {
    console.error(`Unknown qualification ${qual}`);
  }

  return QUALIFICATIONS[qual];
}

function transformMember({ _id, ...record }) {
  // Everyone can at least edit their own availability.
  let permission = 'EDIT_SELF';

  if (PERMISSIONS.includes(record.Permission)) {
    permission = record.Permission;
  }

  // Convert qualifications to enum values.
  const qualifications = record.Quals.map(transformQualification).filter(qual => qual);

  return {
    _id,
    number: parseInt(record.Id, 10),
    permission,
    givenNames: record.Name,
    surname: record.Surname,
    fullName: `${record.Name} ${record.Surname}`,
    qualifications: [...new Set(qualifications)],
    team: record.Team,
  };
}

class MembersDatabase extends DataSource {
  constructor(db) {
    super();
    this.collection = db.then(connection => connection.collection('members'));
  }

  fetchAllMembers() {
    return this.collection.then(members => members.find().map(transformMember).toArray());
  }

  fetchMembers(numbers) {
    const strings = numbers.map(number => number.toString());

    return this
      .collection.then(members => members.find({ Id: { $in: strings } }))
      .then(members => members.map(transformMember).toArray());
  }

  fetchTeamMembers(team) {
    return this.collection
      .then(collection => collection.find({ Team: team }))
      .then(members => members.map(transformMember).toArray());
  }

  fetchMember(number) {
    return this.collection
      .then(collection => collection.findOne({ Id: number.toString() }))
      .then(member => (member ? transformMember(member) : null));
  }

  async authenticateMember(number, password) {
    const collection = await this.collection;
    const member = await collection.findOne({ Id: number.toString() });

    if (!member) {
      return false;
    }

    if (password !== 'password') {
      return false;
    }

    return transformMember(member);
  }

  fetchTeams() {
    return this.collection.then(collection => collection.distinct('Team'));
  }
}

module.exports = MembersDatabase;
