// Migrates from the old shift-based data model to one where intervals are used.

const inquirer = require('inquirer');
const { DateTime, Interval } = require('luxon');
const { MongoClient } = require('mongodb');

require('dotenv').config();

console.log('This migration will clear all availability intervals and re-create them from shift data.');
console.log('This process cannot be reversed');

inquirer
  .prompt([{
    type: 'confirm',
    name: 'confirm',
    message: 'Do you wish to continue?',
    default: false,
  }])
  .then(async ({ confirm }) => {
    if (!confirm) {
      return;
    }

    const mongo = new MongoClient(process.env.MONGODB_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    const conn = await mongo.connect();
    const db = conn.db(process.env.MONGODB_DB);

    const sess = mongo.startSession();
    sess.startTransaction();

    console.log('Starting migration...');
    console.log('Getting existing availability data...');

    const shifts = new Map();

    // Get all existing data and batch it up by member.
    await db.collection('availabilities').find().forEach(({ date, member, shift, available }) => {
      if (!shifts.has(member)) {
        shifts.set(member, []);
      }

      const dt = DateTime.fromJSDate(date, { zone: 'Australia/Sydney' });

      let interval;

      if (shift === 'MORNING') {
        interval = Interval.fromDateTimes(dt.set({ hour: 6 }), dt.set({ hour: 12 }));
      } else if (shift === 'AFTERNOON') {
        interval = Interval.fromDateTimes(dt.set({ hour: 12 }), dt.set({ hour: 18 }));
      } else if (shift === 'NIGHT') {
        interval = Interval.fromDateTimes(dt.set({ hour: 18 }), dt.plus({ days: 1 }).set({ hour: 6 }));
      } else {
        throw 'Unknown shift';
      }

      shifts.get(member).push({ interval, available });
    });

    console.log('Converting shifts to intervals...');

    // Go through each member and merge their available / unavailable blocks into intervals.
    const intervals = [];

    for (const [member, availabilities] of shifts) {
      const available = Interval.merge(
        availabilities.filter(({ available }) => available).map(({ interval }) => interval)
      );
      const unavailable = Interval.merge(
        availabilities.filter(({ available }) => !available).map(({ interval }) => interval)
      );

      for (const { start, end } of available) {
        intervals.push({ member, start: start.toJSDate(), end: end.toJSDate(), storm: 'AVAILABLE' });
      }
      for (const { start, end } of unavailable) {
        intervals.push({ member, start: start.toJSDate(), end: end.toJSDate(), storm: 'UNAVAILABLE' });
      }
    }

    // Now insert the records.
    console.log('Removing existing intervals...');
    await db.collection('availability_intervals').remove({});

    console.log('Inserting intervals...');
    await db.collection('availability_intervals').insertMany(intervals);

    try {
      console.log('Committing results...');
      await sess.commitTransaction();
      sess.endSession();
      console.log('Migration complete');
    } catch (err) {
      console.error('Error committing migration, rolling back...');
      await sess.abortTransaction();
      sess.endSession();
      console.error(err);
    }
  });
