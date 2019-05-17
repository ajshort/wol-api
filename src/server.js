import { ApolloServer, gql } from 'apollo-server'
import { readFileSync } from 'fs'
import path from 'path'

const schema = readFileSync(path.join(__dirname, 'schema.gql'), 'utf-8')
const typeDefs = gql(schema)

const resolvers = {
  Query: {
    hello: () => 'Hello, world'
  }
}

export default new ApolloServer({ typeDefs, resolvers })
