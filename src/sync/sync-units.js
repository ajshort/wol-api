const { UNITS } = require('./config');

const axios = require('axios');
const { MongoClient } = require('mongodb');

require('dotenv').config();

(async () => {
  const api = axios.create({
    baseURL: process.env.SES_API_URL,
    headers: { 'Ocp-Apim-Subscription-Key': process.env.SES_API_KEY },
  });

  // Connect to the database.
  const mongo = new MongoClient(process.env.MONGODB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  const conn = await mongo.connect();
  const db = await conn.db(process.env.MONGODB_DB);

  console.log('Querying units...');

  // Only include units we are aware of.
  const res = await api.get('unit');

  const units = UNITS.map(({ name, code }) => ({
    name,
    code,
    orgdataId: res.data.find(({ Name }) => name === Name).Id,
  }))

  console.log('Inserting units into database...');

  // Insert the results into the database.
  const session = mongo.startSession();

  try {
    await session.withTransaction(async () => {
      const collection = db.collection('units');

      await collection.deleteMany({});
      await collection.insertMany(units);
    });
  } finally {
    await session.endSession();
    await conn.close();
  }
})();
