const { DataSource } = require('apollo-datasource');

class UnitsDb extends DataSource {
  constructor(db) {
    super();
    this.collection = db.then(connection => connection.collection('units'));
  }

  fetchUnit(code) {
    return this.collection.then(collection => {
      return collection.findOne({ code });
    });
  }

  fetchUnits(filter) {
    return this.collection.then(collection => {
      let where = { };

      if (filter && filter.codeAny) {
        where['code'] = { $in: filter.codeAny };
      }

      return collection.find(where).toArray()
    });
  }
}

module.exports = UnitsDb;