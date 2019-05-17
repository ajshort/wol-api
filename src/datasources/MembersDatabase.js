import { DataSource } from 'apollo-datasource';

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

export default class MembersDatabase extends DataSource {
  constructor(client, db) {
    super();

    this.db = client.connect().then(connection => connection.db(db));
    this.members = this.db.then(connection => connection.collection('members'));
  }

  fetchMembers() {
    return this.members.then(members => members.find().map(transformMember).toArray());
  }

  fetchMember(number) {
    return this.db.then(db => db.collection('members').findOne({ number }).then(this.transformMember));
  }
}
