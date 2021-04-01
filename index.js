require('renvy'); // load up env
const http = require('http');
const url = require('url');
const unzip = require('unzip-stream');
const axios = require('axios');
const { extname } = require('path');
const { Sequelize, Model, DataTypes } = require('sequelize');
const index = require('fs').readFileSync('./index.html');

const sequelize = new Sequelize(
  process.env.DATABASE_URL || 'sqlite:zxdb.sqlite',
  {
    logging: false,
  }
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
  const [verb, id, subPart = 1] = req.pathname
    .split('/')
    .filter((_) => _ !== '');

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
  const path = file_link.split('/').slice(3).join('/');

  const ext = path.split('.').slice(-2, -1)[0].toUpperCase();

  const { data: meta } = await axios.get(
    `${process.env.META_HOST}/${path}_CONTENTS/`
  );
  meta
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .filter((_) => _.name.toUpperCase().endsWith(ext));

  const url = `${process.env.FILE_HOST}/${path}_CONTENTS/${
    meta[subPart - 1].name
  }`;

  const { data } = await axios({
    url,
    responseType: 'stream',
    method: 'get',
  });

  res.setHeader('content-length', meta[subPart - 1].size);
  data.pipe(res);
}

async function findFile(req, res) {
  const term = req.query.s.replace(/\*/g, ' '); // allow spectrum to space sep with * instead of %22

  let { data: ids } = await axios({
    url: 'https://api.zxinfo.dk/v3/search',
    headers: { 'user-agent': 'zxdb.remysharp.com' },
    params: {
      query: term,
      mode: 'tiny',
      size: 10,
      offset: 0,
      sort: 'rel_desc',
      output: 'simple',
      genretype: 'GAMES',
      contenttype: 'SOFTWARE',
    },
  });

  ids = ids.map((_) => parseInt(_.id, 10));
  const result = await sequelize.query(
    'select d.id as download_id, e.id as entry_id, * from entries e, downloads d where e.id in (:ids) and e.id == d.entry_id and d.filetype_id in (8, 10)',
    {
      replacements: { ids },
      type: sequelize.QueryTypes.SELECT,
    }
  );

  const sorted = Array.from(result).sort((a, b) => {
    return ids.indexOf(a.entry_id) < ids.indexOf(b.entry_id) ? -1 : 1;
  });

  const meta = await Promise.all(
    sorted
      .map((_) => _.file_link.split('/').slice(3).join('/'))
      .map((_) => {
        const ext = _.split('.').slice(-2, -1)[0].toUpperCase();
        return axios
          .get(`${process.env.META_HOST}/${_}_CONTENTS/`)
          .then(({ data }) => {
            return data
              .sort((a, b) => (a.name < b.name ? -1 : 1))
              .filter((_) => _.name.toUpperCase().endsWith(ext));
          })
          .catch((e) => {
            return [];
          });
      })
  );

  const str =
    sorted
      .map(({ download_id, title, file_link, release_year }, i) => {
        if (!meta[i].length) return null;
        return `^${download_id}^${title}^${file_link
          .split('/')
          .pop()
          .replace(/.zip/, '')}^${meta[i][0].size}^${meta[i].length}^${
          release_year || '?'
        }^`;
      })
      .filter((_) => _ !== null)
      .slice(0, 10)
      .join('\n') + '\n';

  res.setHeader('content-length', str.length);
  res.end(str);
}
