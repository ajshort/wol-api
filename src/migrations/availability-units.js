// Adds units to availabilities where none is recorded for dual members.

const { MongoClient } = require('mongodb');

require('dotenv').config();

(async () => {
  const mongo = new MongoClient(process.env.MONGODB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  const conn = await mongo.connect();
  const db = conn.db(process.env.MONGODB_DB);

  console.log('Starting migration...');
  console.log('Assigning units to availability intervals');

  const sess = mongo.startSession();
  sess.startTransaction();

  await db.collection('members').find().forEach(member => {
    const id = parseInt(member.Id, 10);
    const unit = member.Unit;

    console.log(`Setting ${id} to ${unit}...`);

    return db
      .collection('availability_intervals')
      .updateMany({ member: id }, { $set: { unit } });
  });

  console.log('Assigning units to duty officers');

  await db.collection('duty_officers').updateMany({ }, { $set: { unit: 'WOL' } });

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
})();
