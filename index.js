const http = require('http');
const url = require('url');
const unzip = require('unzip-stream');
const axios = require('axios');
const { extname } = require('path');
const { Sequelize, Model, DataTypes } = require('sequelize');
const index = require('fs').readFileSync('./index.html');

const sequelize = new Sequelize(
  process.env.DATABASE_URL || 'sqlite:zxdb.sqlite'
);

http
  .createServer(function (req, res) {
    const parsed = url.parse(req.url, true);

    req.query = parsed.query;
    req.pathname = parsed.pathname;

    if (parsed.pathname.startsWith('/get/')) {
      getFile(req, res);
    } else {
      if (parsed.query.s) {
        findFile(req, res);
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(index);
      }
    }
  })
  .listen(process.env.PORT || 8000);

async function getFile(req, res) {
  const id = parseInt(req.pathname.split('/').pop(), 10);

  const result = await sequelize.query(
    'select * from downloads d where d.id = ?',
    {
      replacements: [id],
      type: sequelize.QueryTypes.SELECT,
    }
  );

  if (result.length !== 1) {
    return res.end();
  }
  const { file_link } = result[0];
  console.log(file_link);

  const url =
    `https://archive.org/download/World_of_Spectrum_June_2017_Mirror/World%20of%20Spectrum%20June%202017%20Mirror.zip/World%20of%20Spectrum%20June%202017%20Mirror/sinclair/` +
    file_link.substring(file_link.indexOf('/games') + 1);

  const ext = extname(file_link.replace(/.zip$/, '')).toUpperCase();

  const { data } = await axios({
    url,
    responseType: 'stream',
    method: 'get',
  });

  data.pipe(unzip.Parse()).on('entry', (entry) => {
    var filePath = entry.path;
    if (filePath.toUpperCase().endsWith(ext)) {
      entry.pipe(res);
    } else {
      entry.autodrain();
    }
  });
}

function findFile(req, res) {
  const term = req.query.s.replace(/\*/g, ' '); // allow spectrum to space sep with * instead of %22

  sequelize
    .query(
      'select d.id as download_id, * from entries e, downloads d where e.title like :search_name and e.id == d.entry_id and d.filetype_id in (8, 10) limit 10',
      {
        replacements: { search_name: term + '%' },
        type: sequelize.QueryTypes.SELECT,
      }
    )
    .then((result) => {
      result = result.map(
        ({ download_id, title, file_link, release_year }) =>
          `${download_id}^${title}^${file_link
            .split('/')
            .pop()
            .replace(/.zip/, '')}^${release_year}`
      );

      res.end(result.join('\n') + '\n');
    });
}
