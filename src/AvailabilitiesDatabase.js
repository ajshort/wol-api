import { DataSource } from 'apollo-datasource';

export default class AvailabilitiesDatabase extends DataSource {
  constructor(db) {
    super();
    this.collection = db.then(connection => connection.collection('availabilities'));
  }

  fetchMemberAvailabilities(member, from, to) {
    const filter = {
      member,
      date: { $gte: from, $lte: to },
    };

    return this.collection
      .then(collection => collection.find(filter))
      .then(availabilities => availabilities.toArray());
  }

  setAvailabilities(member, availabilities) {
    return this.collection.then((collection) => {
      const bulk = collection.initializeOrderedBulkOp();

      for (const { date, shift, available } of availabilities) {
        bulk.find({ member, date, shift }).upsert().update({
          $set: { available },
        });
      }

      return bulk.execute();
    });
  }
}
