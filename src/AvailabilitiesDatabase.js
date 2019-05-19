const { DataSource } = require('apollo-datasource');
const moment = require('moment-timezone');

const TIME_ZONE = 'Australia/Sydney';

class AvailabilitiesDatabase extends DataSource {
  constructor(db) {
    super();
    this.collection = db.then(connection => connection.collection('availabilities'));
  }

  fetchMemberAvailabilities(member, from, to) {
    const filter = {
      member,
      date: { $gte: from, $lte: to },
    };

    return this.collection
      .then(collection => collection.find(filter))
      .then(availabilities => availabilities.toArray());
  }

  fetchMembersAvailable(instant) {
    let date = moment(instant).tz(TIME_ZONE);
    let shift;

    // Figure out which shift we're in.
    if (date.hour() < 6) {
      date = date.clone().subtract(1, 'day');
      shift = 'NIGHT';
    } else if (date.hour() < 12) {
      shift = 'MORNING';
    } else if (date.hour() < 18) {
      shift = 'AFTERNOON';
    } else {
      shift = 'NIGHT';
    }

    return this.collection.then(collection => collection.distinct('member', {
      date: new Date(date.format('YYYY-MM-DD')),
      shift,
      available: true,
    }));
  }

  setAvailabilities(member, availabilities) {
    return this.collection.then((collection) => {
      const bulk = collection.initializeOrderedBulkOp();

      for (const { date, shift, available } of availabilities) {
        bulk.find({ member, date, shift }).upsert().update({
          $set: { available },
        });
      }

      return bulk.execute();
    });
  }
}

module.exports = AvailabilitiesDatabase;
