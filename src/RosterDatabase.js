const { DataSource } = require('apollo-datasource');

class RosterDatabase extends DataSource {
  constructor(db) {
    super();
    this.collection = db.then(connection => connection.collection('roster'));
  }

  fetchShiftTeams(unit) {
    return this.collection
      .then(collection => collection.findOne({ Unit: unit }))
      .then(res => (res ? { day: res.Day, night: res.Night } : null));
  }
}

module.exports = RosterDatabase;
