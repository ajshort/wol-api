# Wollongong SES API

## Setup

Set the following environment variables (you can use a `.env` file):

* `MONGODB_URL` - the mongodb connection URL.
* `MONGODB_DB` - the database name to use.
* `JWT_SECRET` - JWT signing secret.

Then:

    npm install
    npm run dev

And open `http://localhost:4000` in your browser to access the GraphQL playground.

## Basic Usage

You need an auth token to access must queries, run the login mutation in the playground to generate
one:

    mutation {
      login(memberNumber: 400..., password: "<password>") {
        token
      }
    }

This will return a response with a token field. Open the "HTTP Headers" section down the bottom
of the playground and set it to:

    {
      "Authorization": "Bearer <token>"
    }

You can then run the remaining queries, such as getting a list of unit members:

    {
      members {
        number
        fullName
        team
      }
    }

Use the "Schema" tab on the right to explore the available queries and fields.

## Example Queries

A week's availablility for an individual member:

    {
      member(number: 40000000) {
        fullName
        team
        availabilities(from: "2019-01-01", to: "2019-01-08") {
          date
          shift
          available
        }
      }
    }

Set member availability:

    mutation {
      setAvailabilities(memberNumber: 40000000, availabilities: [
        {
          date: "2019-01-01"
          shift: MORNING
          available: true
        }
        {
          date: "2019-01-02"
          shift: AFTERNOON
          available: false
        }
      ])
    }

Members currently available:

    {
      membersAvailable {
        fullName
        mobile
      }
    }
