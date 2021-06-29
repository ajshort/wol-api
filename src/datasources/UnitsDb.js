const UNITS = require('./units');

const { DataSource } = require('apollo-datasource');

class UnitsDb extends DataSource {
  fetchUnit(code) {
    return UNITS.find(unit => unit.code === code);
  }

  fetchUnits(filter) {
    let units = UNITS;

    if (filter && filter.codeAny) {
      units = units.filter(({ code }) => filter.codeAny.includes(code));
    }

    return units;
  }
}

module.exports = UnitsDb;
