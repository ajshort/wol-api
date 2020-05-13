const { DataSource } = require('apollo-datasource');
const DataLoader = require('dataloader');
const { DateTime, Interval } = require('luxon');

class AvailabilitiesDb extends DataSource {
  constructor(client, db) {
    super();

    this.client = client;
    this.collection = db.then(connection => connection.collection('availability_intervals'));
    this.loader = new DataLoader(keys => this.loadMemberAvailabilities(keys));
  }

  fetchMemberAvailabilities(member, start, end) {
    return this.loader.load({
      member,
      interval: Interval.fromDateTimes(DateTime.fromJSDate(start), DateTime.fromJSDate(end)),
    });
  }

  fetchMembersAvailabilities(members, start, end) {
    return this.collection.then(collection => (
      collection.find({
        member: { $in: members },
        start: { $lte: end },
        end: { $gte: start },
      }).toArray()
    ));
  }

  loadMemberAvailabilities(filters) {
    // Batch up queries with the same interval and get all members availabilities.
    const batches = new Map();

    for (const { member, interval } of filters) {
      const key = interval.toString();

      if (batches.has(key)) {
        batches.get(key).members.push(member);
      } else {
        batches.set(key, { interval, members: [member] });
      }
    }

    return this.collection
      .then(collection => (
        Promise.all(Array.from(batches, ([, { interval, members }]) => (
          collection.find({
            member: { $in: members },
            start: { $lte: interval.end.toJSDate() },
            end: { $gte: interval.start.toJSDate() },
          }).toArray()
        )))
      ))
      .then(results => results.flat())
      .then(results => filters.map(({ member, interval }) => results.filter(result => (
        result.member === member
        && result.start.getTime() <= interval.end.toJSDate()
        && result.end.getTime() >= interval.start.toJSDate()
      ))));
  }

  async setAvailabilities(start, end, members, availabilities) {
    const session = this.client.startSession();
    const collection = await this.collection;

    session.startTransaction();

    // Delete any engulfed values.
    await collection.deleteMany({
      member: { $in: members }, start: { $gte: start }, end: { $lte: end },
    });

    // If an existing range fully engulfs this, update the engulfer to abut this, and then
    // copy it after.
    const engulfing = await collection.findOneAndUpdate(
      { member: { $in: members }, start: { $lt: start }, end: { $gt: end } },
      { $set: { end: start } },
    );

    if (engulfing.value) {
      await collection.insertOne({ ...engulfing.value, _id: new ObjectID(), start: end });
    }

    // Update an existing range which overlaps the start of this range.
    await collection.update(
      { member: { $in: members }, end: { $gt: start, $lte: end } },
      { $set: { end: start } },
    );

    // Update an existing range which overlaps the end of this range.
    await collection.update(
      { member: { $in: members }, start: { $gte: start, $lt: end } },
      { $set: { start: end } },
    );

    // Insert the availability values that we have.
    if (availabilities.length > 0) {
      await collection.insertMany(availabilities);
    }

    try {
      await session.commitTransaction();
      session.endSession();
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }
}

module.exports = AvailabilitiesDb;
