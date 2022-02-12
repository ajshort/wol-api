const { DataSource } = require('apollo-datasource');

class UnitsDb extends DataSource {
  constructor(db) {
    super();

    this.collection = db.then(connection => connection.collection('units'));
  }

  fetchUnit(code) {
    return this.collection.then(coll => coll.findOne({ code }));
  }

  fetchUnits(filter) {
    const where = { };

    if (filter && filter.codeAny) {
      where['code'] = { $in: filter.codeAny };
    }

    return this.collection.then(coll => coll.find(where).toArray());
  }
}

module.exports = UnitsDb;
