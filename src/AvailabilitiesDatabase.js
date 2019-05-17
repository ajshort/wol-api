import { DataSource } from 'apollo-datasource';

export default class AvailabilitiesDatabase extends DataSource {
  constructor(db) {
    super();
    this.collection = db.then(connection => connection.collection('availabilities'));
  }
}
