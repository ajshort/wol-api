const { DataSource } = require('apollo-datasource');
const moment = require('moment-timezone');

const TIME_ZONE = 'Australia/Sydney';

class DutyOfficersDb extends DataSource {
  constructor(client, db) {
    super();

    this.client = client;
    this.collection = db.then(connection => connection.collection('duty_officers'));
  }

  fetchDutyOfficersAt(instant) {
  }

  fetchDutyOfficers(from, to) {
    return this.collection.then(collection => collection.find().toArray());
  }

  async setDutyOfficer(shift, member, from, to) {
    const session = this.client.startSession();
    const collection = await this.collection;

    session.startTransaction();

    try {
      // Delete any fully overlapped ranges.
      collection.deleteMany({
        from: { $gte: from },
        to: { $lte: to },
      });

      // If an existing range fully overlaps this, split it.

      // Update an existing range which overlaps the start of this range.

      // Update an existing range which overlaps the end of this range.

      // Insert the range itself.
      collection.insertOne({ shift, from, to, member });

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
