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

  // Repeatedly query a list of all units until we have all of them.
  let units = [];

  for (let page = 1; ; ++page) {
    console.log(`Querying units (page ${page})...`);

    const response = await api.get('orgUnits', { params: { PageNumber: page, PageSize: 50 } });
    const { currentPage, totalPages, results } = response.data;

    units = units.concat(results);

    if (currentPage >= totalPages) {
      break;
    }
  }

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
