const UNITS = require('./units');

const { DataSource } = require('apollo-datasource');
const DataLoader = require('dataloader');
const { sha512crypt } = require('sha512crypt-node');

// A map of SAP to local database qualification names.
const SAP_QUALIFICATIONS = {
  'VR-ACC': 'Vertical Rescue (PUASAR004B/PUASAR032A)',
  'CL1-ACC': 'Chainsaw Operator (Cross-Cut & Limb)',
  'CL2-ACC': 'Chainsaw Operator (Tree Felling)',
  'SWDG-ACC': 'Storm and Water Damage Operation',
  'SAR1-ACC': 'Land Search Team Member',
  'FRL1-ACC': 'Swiftwater Rescue Awareness (FR L1)',
  'FRL2-ACC': 'Flood Rescue Boat Operator (FR L2)',
  'FRL3-ACC': 'Swiftwater Rescue Technician (FR L3)',
};

const LOCAL_QUALIFICATIONS = Object.fromEntries(
  Object.entries(SAP_QUALIFICATIONS).map(([k, v]) => ([v, k]))
);

function transformMember({ _id, ...record }) {
  const qualifications = record.Quals.map(local => {
    if (local in LOCAL_QUALIFICATIONS) {
      return LOCAL_QUALIFICATIONS[local];
    } else {
      return local;
    }
  })

  switch (record.DriverClassification) {
    case 2:
      qualifications.push('DRL1-ACC');
      break;
    case 3:
    case 4:
      qualifications.push('DRL2-ACC');
      break;
    case 5:
    case 6:
      qualifications.push('DRL3-ACC');
      break;
  }

  return {
    _id,
    number: parseInt(record.Id, 10),
    firstName: record.Name,
    lastName: record.Surname,
    preferredName: record.Name,
    fullName: `${record.Name} ${record.Surname}`,
    qualifications,
    rank: record.Rank,
    mobile: record.Mobile,
    callsign: record.Callsign,
    location: record.Location,
    units: record.Units.map(unit => ({
      code: unit.Unit,
      name: UNITS.find(({ code }) => unit.Unit === code).name,
      team: unit.Team === 'None' ? null : unit.Team,
      permission: (unit.Permission === 'EDIT_TEAM' || unit.Permission === 'EDIT_UNIT') ? unit.Permission : 'EDIT_SELF',
    })),
  };
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
        where['Units.Unit'] = { $in: filter.unitsAny };
      }

      if (filter && filter.qualificationsAny && filter.qualificationsAny.length > 0) {
        where['Quals'] = { $in: filter.qualificationsAny.map(local => {
          if (local in SAP_QUALIFICATIONS) {
            return SAP_QUALIFICATIONS[local];
          } else {
            return local;
          }
        }) };
      }

      return members.find(where).map(transformMember).toArray();
    });
  }

  async fetchMembers(numbers) {
    const members = await this.collection
      .then(collection => collection.find({ Id: { $in: numbers.map(number => number.toString()) } }))
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
    const member = await collection.findOne({ Id: number.toString() });

    if (!member) {
      return false;
    }

    // Extract the salt from the password.
    const expected = member.Password;
    const salt = expected.split('$').filter(s => s.length > 0)[1];
    const crypted = sha512crypt(password, salt);

    if (crypted !== expected) {
      return false;
    }

    return transformMember(member);
  }
}

module.exports = MembersDb;
