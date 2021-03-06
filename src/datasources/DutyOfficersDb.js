const { DataSource } = require('apollo-datasource');
const { ObjectID } = require('mongodb');

class DutyOfficersDb extends DataSource {
  constructor(client, db) {
    super();

    this.client = client;
    this.collection = db.then(connection => connection.collection('duty_officers'));
  }

  fetchDutyOfficersAt(unit, instant) {
    return this.collection.then(collection => (
      collection.find({ unit, from: { $lte: instant }, to: { $gt: instant } }).toArray()
    ));
  }

  fetchDutyOfficers(unit, from, to) {
    return this.collection.then(collection => (
      collection.find({ unit, from: { $lte: to }, to: { $gte: from } }).toArray()
    ));
  }

  async setDutyOfficer(unit, shift, member, from, to) {
    const session = this.client.startSession();
    const collection = await this.collection;

    session.startTransaction();

    try {
      // Delete any fully overlapped ranges.
      await collection.deleteMany({
        unit, shift, from: { $gte: from }, to: { $lte: to },
      });

      // If an existing range fully engulfs this, update the englufer to abut this, and then
      // copy it after.
      const engulfing = await collection.findOneAndUpdate(
        { unit, shift, from: { $lt: from }, to: { $gt: to } },
        { $set: { to: from } },
      );

      if (engulfing.value) {
        await collection.insertOne({ ...engulfing.value, _id: new ObjectID(), from: to });
      }

      // Update an existing range which overlaps the start of this range.
      await collection.update(
        { unit, shift, to: { $gt: from, $lte: to } },
        { $set: { to: from } },
      );

      // Update an existing range which overlaps the end of this range.
      await collection.update(
        { unit, shift, from: { $gte: from, $lt: to } },
        { $set: { from: to } },
      );

      // Insert the range itself, unless we don't have a member.
      if (member !== null) {
        collection.insertOne({ unit, shift, from, to, member });
      }

      await session.commitTransaction();
      session.endSession();
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }
}

module.exports = DutyOfficersDb;
