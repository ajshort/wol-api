const { DataSource } = require('apollo-datasource');
const DataLoader = require('dataloader');
const moment = require('moment-timezone');

const TIME_ZONE = 'Australia/Sydney';

class AvailabilitiesDb extends DataSource {
  constructor(db) {
    super();

    this.collection = db.then(connection => connection.collection('availabilities'));
    this.loader = new DataLoader(keys => this.fetchMultipleMemberAvailabilities(keys));
  }

  fetchMemberAvailabilities(member, from, to) {
    return this.loader.load({ member, from, to });
  }

  fetchMultipleMemberAvailabilities(filters) {
    // Batch up queries with the same date range and get all members availabilities.
    const batches = new Map();

    for (const { member, from, to } of filters) {
      const key = `${moment(from).format('YYYY-MM-DD')}-${moment(to).format('YYYY-MM-DD')}`;

      if (batches.has(key)) {
        batches.get(key).members.push(member);
      } else {
        batches.set(key, { from, to, members: [member] });
      }
    }

    return this.collection
      .then(collection => (
        Promise.all(Array.from(batches, ([, { from, to, members }]) => (
          collection.find({
            member: { $in: members },
            date: { $gte: from, $lte: to },
          }).toArray()
        )))
      ))
      .then(results => results.flat())
      .then(results => filters.map(filter => results.filter(result => (
        result.member === filter.member
        && result.date.getTime() >= filter.from.getTime()
        && result.date.getTime() <= filter.to.getTime()
      ))));
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

module.exports = AvailabilitiesDb;
