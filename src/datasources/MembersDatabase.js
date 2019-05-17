import { DataSource } from 'apollo-datasource';

export default class MembersDatabase extends DataSource {
  constructor(client, db) {
    super();
    this.db = client.connect().then(connection => connection.db(db));
  }

  fetchMembers() {
    return this.db.then(db => db.collection('members').find().toArray());
  }

  fetchMember(number) {
    return this.db.then(db => db.collection('members').findOne({ number }));
  }
}
