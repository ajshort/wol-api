const { QUALIFICATION_CODES, UNIT_CODES } = require('./config');

const axios = require('axios');
const axiosRetry = require('axios-retry');
const _ = require('lodash');
const { MongoClient } = require('mongodb');

require('dotenv').config();

(async () => {
  const api = axios.create({
    baseURL: process.env.SES_API_URL,
    headers: { 'Ocp-Apim-Subscription-Key': process.env.SES_API_KEY },
  });

  axiosRetry(api, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

  // Connect to the database.
  const mongo = new MongoClient(process.env.MONGODB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  const conn = await mongo.connect();
  const db = await conn.db(process.env.MONGODB_DB);

  // Go through each unit, then query member ID's and amalgamate it into one big list. A member
  // may be in multiple units. We don't get actual member data yet.
  let ids = new Set();

  for (const code of UNIT_CODES) {
    console.log(`Querying unit "${code}"...`);

    const unit = await db.collection('units').findOne({ code });

    if (!unit) {
      console.error(`Could not query the unit "${code}"`);
      continue;
    }

    for (let page = 1; ; ++page) {
      console.log(`Querying members of "${code}" (page ${page})...`);

      const response = await api.get(`orgUnits/${unit.id}/people`, { params: { PageNumber: page, PageSize: 50 } });
      const { currentPage, totalPages, results } = response.data;

      for (const { id } of results) {
        ids.add(id);
      }

      if (currentPage >= totalPages) {
        break;
      }
    }
  }

  // Go through each member and get their full data now. We do this serially currently, could be
  // parallelised but may run into API issues.
  const members = [];

  for (const [index, id] of Array.from(ids).entries()) {
    console.log(`Querying member ${id} (${index + 1}/${ids.size})...`);

    const response = await api.get(`/people/${id}`);
    const data = _.pick(response.data, [
      'id',
      'firstName',
      'lastName',
      'preferredName',
      'assignments',
      'contactDetails',
      'ranks',
      'roles',
      'qualifications',
      'units',
    ]);

    // For some reason ID is a string?
    data.id = parseInt(data.id, 10);

    // We only care about some qualifications.
    data.qualifications = data.qualifications.filter(({ code }) => QUALIFICATION_CODES.includes(code));

    // Look up assignments to get the list of units, augmenting with role names.
    const units = await db
      .collection('units')
      .find({ id: { $in: data.assignments.map(assignment => assignment.orgUnitId) }, })
      .toArray();

    data.units = units.map(unit => ({
      ...unit,
      roles: data.roles.filter(role => role.orgUnit.id === unit.id).map(role => role.name),
      team: _.sample(['Alpha', 'Bravo', 'Charlie', 'Delta']),
    }));

    members.push(data);
  }

  console.log('Inserting members into database...');

  // Insert the results into the database.
  const session = mongo.startSession();

  try {
    await session.withTransaction(async () => {
      const collection = db.collection('members');

      await collection.deleteMany({});
      await collection.insertMany(members);
    });
  } finally {
    await session.endSession();
    await conn.close();
  }
})();
