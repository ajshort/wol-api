const { DataSource } = require('apollo-datasource');

function transformMember({ _id, ...record }) {
  const names = record.Name.split(' ');

  return {
    _id,
    number: parseInt(record.Id, 10),
    fullName: record.Name,
    givenNames: names.slice(0, -1).join(' '),
    surname: names[names.length - 1],
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
