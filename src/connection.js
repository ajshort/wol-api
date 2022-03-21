const { MongoClient } = require('mongodb');

const url = process.env.MONGODB_URL;
const opts = {
  autoReconnect: true,
  reconnectInterval: 2500,
  reconnectTries: 5,
  connectTimeoutMS: 10000,
  serverSelectionTimeoutMS: 10000,
  useNewUrlParser: true,
  useUnifiedTopology: false,
};

let client;
let clientPromise;

if (process.env.NODE_ENV === 'development') {
  if (!global._connectionPromise) {
    client = new MongoClient(url, opts);
    global._connectionPromise = client.connect();
  }

  clientPromise = global._connectionPromise;
} else {
  client = new MongoClient(url, opts);
  clientPromise = client.connect();
}

exports.client = client;
exports.clientPromise = clientPromise;
