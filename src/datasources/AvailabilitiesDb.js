const { DataSource } = require('apollo-datasource');
const _ = require('lodash');
const { DateTime, Interval } = require('luxon');

const VERTICAL_RESCUE = 'VR-ACC';
const FLOOD_RESCUE_L1 = 'FRL1-ACC';
const FLOOD_RESCUE_L2 = 'FRL2-ACC';
const FLOOD_RESCUE_L3 = 'FRL3-ACC';

class AvailabilitiesDb extends DataSource {
  constructor(client, db) {
    super();

    this.client = client;
    this.collection = db.then(connection => connection.collection('availability_intervals'));
    this.defaults = db.then(connection => connection.collection('default_availabilities'));
  }

  fetchMemberAvailabilities(unit, member, start, end) {
    return this.collection.then(collection => (
      collection.find({
        unit,
        member,
        start: { $lte: end },
        end: { $gte: start },
      }).toArray()
    ));
  }

  fetchMembersAvailabilities(unit, members, start, end) {
    return this.collection.then(collection => (
      collection.find({
        unit,
        member: { $in: members },
        start: { $lte: end },
        end: { $gte: start },
      }).toArray()
    ));
  }

  fetchAvailableAt(unitCodes, instant) {
    return this.collection.then(collection => {
      const filter = {
        unit: { $in: unitCodes },
        start: { $lte: instant },
        end: { $gt: instant },
        $or: [
          { storm: 'AVAILABLE' },
          { rescue: { $in: ['IMMEDIATE', 'SUPPORT'] } },
        ],
      };

      return collection.find(filter).toArray()
    });
  }

  async setAvailabilities(unit, member, start, end, availabilities) {
    const session = this.client.startSession();
    const collection = await this.collection;

    session.startTransaction();

    // Delete any engulfed values.
    await collection.deleteMany({
      unit, member, start: { $gte: start }, end: { $lte: end },
    });

    // If an existing range fully engulfs this, update the engulfer to abut this, and then
    // copy it after.
    const engulfing = await collection.findOneAndUpdate(
      { unit, member, start: { $lt: start }, end: { $gt: end } },
      { $set: { end: start } },
    );

    if (engulfing.value) {
      await collection.insertOne({ ...engulfing.value, _id: new ObjectID(), start: end });
    }

    // Update an existing range which overlaps the start of this range.
    await collection.update(
      { unit, member, end: { $gt: start, $lte: end } },
      { $set: { end: start } },
    );

    // Update an existing range which overlaps the end of this range.
    await collection.update(
      { unit, member, start: { $gte: start, $lt: end } },
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

  async fetchStatistics(stormUnits, rescueUnits, start, end, membersSource) {
    const interval = Interval.fromDateTimes(DateTime.fromJSDate(start), DateTime.fromJSDate(end));
    const units = _.uniq(_.concat(stormUnits, rescueUnits));

    // Get availabilities within the period which have some useful info.
    const collection = await this.collection;
    const records = await collection.find({
      unit: { $in: units },
      start: { $lte: end },
      end: { $gte: start },
    }).toArray();

    // Get members of interest.
    const members = await membersSource.fetchAllMembers({ unitsAny: units });

    // Make a list of teams.
    const teams = {};

    for (const unit of units) {
      teams[unit] = {};
    }

    for (const member of members) {
      for (const membership of member.units) {
        if (!units.includes(membership.code)) {
          continue;
        }

        if (!_.has(teams[membership.code], membership.team)) {
          teams[membership.code][membership.team] = { members: 1, enteredStorm: new Set() };
        } else {
          teams[membership.code][membership.team].members++;
        }
      }
    }

    // Go through and sum up the total available seconds of all members.
    const summations = {};

    for (const member of members) {
      summations[member.number] = { storm: 0, rescueImmediate: 0, rescueSupport: 0, rescueUnavailable: 0 };
    }

    for (const record of records) {
      // Might be a deleted member.
      if (!(record.member in summations)) {
        continue;
      }

      const member = members.find(member => member.number === record.member);

      const intersection = Interval
        .fromDateTimes(DateTime.fromJSDate(record.start), DateTime.fromJSDate(record.end))
        .intersection(interval);

      if (!intersection) {
        continue;
      }

      const duration = intersection ? intersection.count('seconds') : 0;

      if (record.storm === 'AVAILABLE') {
        summations[record.member].storm += duration;
      }

      if (record.rescue === 'IMMEDIATE') {
        summations[record.member].rescueImmediate += duration;
      } else if (record.rescue === 'SUPPORT') {
        summations[record.member].rescueSupport += duration;
      } else if (record.rescue === 'UNAVAILABLE') {
        summations[record.member].rescueUnavailable += duration;
      }

      if (record.storm) {
        for (const { code, team } of member.units) {
          if (!units.includes(code)) {
            continue;
          }

          teams[code][team].enteredStorm.add(record.member);
        }
      }
    }

    // Create a set of all points where availabilities could change, filtering out ones that fall
    // outside the bounds.
    const inflections = _.uniq([
      start.getTime(),
      end.getTime(),
      ...records
        .flatMap(({ start, end }) => [start.getTime(), end.getTime()])
        .filter(time => time >= start.getTime() && time < end.getTime())
    ]).sort();

    // Then go through and generate counts. Also keep track of which members have entered
    // anything.
    const counts = [];
    const enteredStorm = new Set();
    const enteredRescue = new Set();

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

        // Maybe the member has resigned
        if (!member) {
          continue;
        }

        if (record.storm) {
          enteredStorm.add(member.number);
        }
        if (record.rescue) {
          enteredRescue.add(member.number);
        }

        if (stormUnits.includes(record.unit) && record.storm === 'AVAILABLE') {
          count.storm++;
        }

        if (!rescueUnits.includes(record.unit)) {
          continue;
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

    const teamsResult = _.flatten(Object.entries(teams).map(([unit, teams]) => {
      return Object.entries(teams).map(([team, data]) => ({
        unit,
        team,
        members: data.members,
        enteredStorm: data.enteredStorm.size,
      }));
    }));

    return {
      counts,
      members: Object.entries(summations).map(([member, counts]) => ({ member: parseInt(member, 10), ...counts })),
      teams: teamsResult,
    };
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

  async applyDefaultAvailability(unit, member, start, end) {
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
          unit,
          member,
          start: interval.start.toJSDate(),
          end: interval.end.toJSDate(),
        };
      })
      .filter(entry => entry !== null);

    await this.setAvailabilities(unit, member, start, end, availabilities);

    return true;
  }
}

module.exports = AvailabilitiesDb;
