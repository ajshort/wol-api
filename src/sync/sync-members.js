const { QUALIFICATION_CODES, UNIT_NAMES } = require('./config');

const axios = require('axios');
const _ = require('lodash');
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

  // Go through each unit, then query member ID's and amalgamate it into one big list. A member
  // may be in multiple units. We don't get actual member data yet.
  let ids = new Set();

  const units = await db.collection('units').find({}).toArray();

  for (const { name, orgdataId } of units) {
    console.log(`Querying unit "${name}"...`);

    const res = await api.get(`unit/${orgdataId}/members`);

    for (const member of res.data) {
      ids.add(member.Id);
    }
  }

  // Go through each member and get their full data now. We do this serially currently, could be
  // parallelised but may run into API issues.
  const members = [];

  for (const [index, id] of Array.from(ids).entries()) {
    console.log(`Refreshing and querying member ${id} (${index + 1}/${ids.size})...`);

    await api.post(`member/refresh?id=${id}`);

    const { data: member } = await api.get(`member/${id}/detailed`);

    const data = {
      number: member.Id,
      title: member.Title,
      firstName: member.FirstName,
      lastName: member.LastName,
      preferredName: member.PreferredName,
      fullName: `${member.PreferredName || member.FirstName} ${member.LastName}`,
      qualifications: (member.Qualifications || [])
        .map(({ Name, Abbrev }) => ({ code: Abbrev, name: Name }))
        .filter(({ code }) => QUALIFICATION_CODES.includes(code)),
      units: member.Positions.map(({ Name, Abbrev }) => ({ code: Abbrev, name: Name, team: null })),
    };

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
