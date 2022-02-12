const UNITS = require('./units');

const { DataSource } = require('apollo-datasource');
const DataLoader = require('dataloader');

function transformMember(member) {
  return { ...member, qualifications: member.qualifications?.map(({ code }) => code) };
}

class MembersDb extends DataSource {
  constructor(db) {
    super();

    this.collection = db.then(connection => connection.collection('members'));
    this.loader = new DataLoader(keys => this.fetchMembers(keys));
  }

  fetchAllMembers(filter) {
    return this.collection.then((members) => {
      const where = { };

      if (filter && filter.unitsAny) {
        where['units.code'] = { $in: filter.unitsAny };
      }

      if (filter && filter.qualificationsAny && filter.qualificationsAny.length > 0) {
        where['qualifications.code'] = { $in: filter.qualificationsAny };
      }

      return members.find(where).map(transformMember).toArray();
    });
  }

  async fetchMembers(numbers) {
    const members = await this.collection
      .then(collection => collection.find({ number: { $in: numbers } }))
      .then(result => result.map(transformMember).toArray());

    // Order members so they're in the same order.
    const result = new Array(numbers.length);

    for (let i = 0; i < numbers.length; ++i) {
      result[i] = members.find(member => member.number === numbers[i]);
    }

    return result;
  }

  fetchMember(number) {
    return this.loader.load(number);
  }

  fetchTeams(unit) {
    return this.collection.then(collection => (
      collection.distinct('Team', unit !== undefined ? { Unit: unit } : undefined)
    ));
  }

  fetchQualifications() {
    return this.collection.then(collection => {
      return collection.aggregate([
        { $unwind: '$qualifications' },
        { $replaceWith: '$qualifications' },
        { $group: {
          _id: { code: '$code' },
          code: { $first: '$code' },
          name: { $first: '$text' }
        } }
      ]).toArray();
    });
  }

  async authenticateMember(number, password) {
    const collection = await this.collection;
    const member = await collection.findOne({ number });

    if (!member) {
      return false;
    }

    // TODO we need to add password auth somehow.
    return member;
  }
}

module.exports = MembersDb;
