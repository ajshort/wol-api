import server from './server';

server.listen().then(({ port }) => {
  console.log(`🚀 Server listening on port ${port}`);
});
