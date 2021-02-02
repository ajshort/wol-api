const { DataSource } = require('apollo-datasource');
const DataLoader = require('dataloader');
const _ = require('lodash');
const { DateTime, Interval } = require('luxon');

const VERTICAL_RESCUE = 'Vertical Rescue (PUASAR004B/PUASAR032A)';
const FLOOD_RESCUE_L1 = 'Swiftwater Rescue Awareness (FR L1)';
const FLOOD_RESCUE_L2 = 'Flood Rescue Boat Operator (FR L2)';
const FLOOD_RESCUE_L3 = 'Swiftwater Rescue Technician (FR L3)';
const PAD = 'PAD Operator';

class AvailabilitiesDb extends DataSource {
  constructor(client, db) {
    super();

    this.client = client;
    this.collection = db.then(connection => connection.collection('availability_intervals'));
    this.defaults = db.then(connection => connection.collection('default_availabilities'));
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

  fetchAvailableAt(instant, members) {
    return this.collection.then(collection => {
      const filter = {
        start: { $lte: instant },
        end: { $gt: instant },
        $or: [
          { storm: 'AVAILABLE' },
          { rescue: { $in: ['IMMEDIATE', 'SUPPORT'] } },
        ],
      };

      if (typeof members !== 'undefined') {
        filter.member = { $in: members };
      }

      return collection.find(filter).toArray()
    });
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

  async fetchStatistics(start, end, unit, membersSource) {
    // Get availabilities within the period which have some useful info.
    const collection = await this.collection;
    const records = await collection.find({
      start: { $lte: end },
      end: { $gte: start },
      $or: [
        { storm: 'AVAILABLE' },
        { rescue: 'IMMEDIATE' },
        { rescue: 'SUPPORT' },
      ],
    }).toArray();

    // Get members of interest.
    const memberNumbers = _.uniq(records.map(record => record.member));
    const members = await membersSource.fetchMembers(memberNumbers);

    // Create a set of all points where availabilities could change, filtering out ones that fall
    // outside the bounds.
    const inflections = _.uniq([
      start.getTime(),
      end.getTime(),
      ...records
        .flatMap(({ start, end }) => [start.getTime(), end.getTime()])
        .filter(time => time >= start.getTime() && time < end.getTime())
    ]).sort();

    // Then go through and generate counts.
    const counts = [];

    for (let i = 1; i < inflections.length; ++i) {
      const start = new Date(inflections[i - 1]);
      const end = new Date(inflections[i]);

      const count = {
        start,
        end,
        storm: 0,
        vr: { immediate: 0, support: 0 },
        frInWater: { immediate: 0, support: 0 },
        frOnWater: { immediate: 0, support: 0 },
        frOnLand: { immediate: 0, support: 0 },
      };

      for (const record of records.filter(record => record.start <= start && record.end > start)) {
        const member = members.find(member => member.number === record.member);

        if ((!unit || member.unit === unit) && record.storm === 'AVAILABLE') {
          count.storm++;
        }

        if (record.rescue === 'IMMEDIATE' || record.rescue === 'SUPPORT') {
          if (member.qualifications.includes(VERTICAL_RESCUE)) {
            if (record.rescue === 'IMMEDIATE') {
              count.vr.immediate++;
            } else {
              count.vr.support++;
            }
          }

          const l3 = member.qualifications.includes(FLOOD_RESCUE_L3);
          const l2 = member.qualifications.includes(FLOOD_RESCUE_L2);

          if (l3) {
            if (record.rescue === 'IMMEDIATE') {
              count.frInWater.immediate++;
            } else {
              count.frInWater.support++;
            }
          }

          if (l2) {
            if (record.rescue === 'IMMEDIATE') {
              count.frOnWater.immediate++;
            } else {
              count.frOnWater.support++;
            }
          }

          if (!l3 && !l2 && member.qualifications.includes(FLOOD_RESCUE_L1)) {
            if (record.rescue === 'IMMEDIATE') {
              count.frOnLand.immediate++;
            } else {
              count.frOnLand.support++;
            }
          }
        }
      }

      counts.push(count);
    }

    return { counts };
  }

  fetchDefaultAvailabilties(member) {
    return this.defaults.then(collection => collection.findOne({ member }));
  }

  async setDefaultAvailabilities(member, start, availabilities) {
    const defaults = await this.defaults;

    await defaults.updateOne(
      { member },
      { $set: { member, start, availabilities } },
      { upsert: true },
    );
  }

  async applyDefaultAvailability(member, start, end) {
    const defaults = await this.defaults;
    const data = await defaults.findOne({ member });

    if (!data) {
      return false;
    }

    const bounds = Interval.fromDateTimes(DateTime.fromJSDate(start), DateTime.fromJSDate(end));
    const origin = DateTime.fromJSDate(data.start);

    // Go through each availability and offset it from the reference start to the proper start.
    const availabilities = data.availabilities
      .map((entry) => {
        const interval = Interval
          .fromDateTimes(
            DateTime.fromJSDate(start).plus(DateTime.fromJSDate(entry.start).diff(origin)),
            DateTime.fromJSDate(start).plus(DateTime.fromJSDate(entry.end).diff(origin)),
          )
          .intersection(bounds);

        if (!interval.isValid || interval.isEmpty()) {
          return null;
        }

        return {
          ...entry,
          member,
          start: interval.start.toJSDate(),
          end: interval.end.toJSDate(),
        };
      })
      .filter(entry => entry !== null);

    await this.setAvailabilities(start, end, [member], availabilities);

    return true;
  }
}

module.exports = AvailabilitiesDb;
