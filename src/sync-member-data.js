const axios = require('axios');
const { MongoClient } = require('mongodb');

require('dotenv').config();

(async () => {
  const api = axios.create({
    baseURL: process.env.SES_API_URL,
    headers: { 'Ocp-Apim-Subscription-Key': process.env.SES_API_KEY },
  });

  // Repeatedly query a list of all units until we have all of them.
  let units = [];

  for (let page = 0; ; ++page) {
    console.log(`Querying units (page ${page})...`);

    const response = await api.get('orgUnits', {
      params: { PageNumber: page, PageSize: 50 },
    });

    const { totalPages, results } = response.data;

    units = units.concat(results);

    if (page >= totalPages) {
      break;
    }
  }

  // Go through each unit that uses the app, and query their list of people.
  for (const code of ['SEZ-NIC-WOL']) {
    const unit = units.find(unit => unit.code === code);
    let ids = [];

    for (let page = 0; ; ++page) {
      console.log(`Querying members from ${code} (page ${page})...`);

      const response = await api.get(`/orgUnits/${unit.id}/people`, {
        params: { PageNumber: page, PageSize: 50 },
      });

      const { totalPages, results } = response.data;

      ids = ids.concat(results.map(result => result.id));

      if (page >= totalPages) {
        break;
      }
    }

    console.log(ids);
  }
})();
