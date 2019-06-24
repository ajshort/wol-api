const { DataSource } = require('apollo-datasource');

class VehiclesDb extends DataSource {
  constructor(db) {
    super();
    this.collection = db.then(connection => connection.collection('vehicles'));
  }

  fetchVehicles() {
    return this.collection.then(vehicles => vehicles.find().sort({ callsign: 1 }).toArray());
  }

  fetchVehicle(callsign) {
    return this.collection.then(vehicles => vehicles.findOne({ callsign }));
  }

  setVehicleWith(callsign, wth, info) {
    return this.collection.then(vehicles => vehicles.update(
      { callsign },
      {
        away: true,
        callsign,
        with: wth,
        info,
      },
      { upsert: true },
    ));
  }

  returnVehicle(callsign) {
    return this.collection.then(vehicles => vehicles.update(
      { callsign }, { callsign, away: false }, { upsert: true },
    ));
  }
}

module.exports = VehiclesDb;
