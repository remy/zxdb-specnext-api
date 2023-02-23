require('renvy'); // load up env
const http = require('http');
const url = require('url');
const fs = require('fs');
const unzip = require('unzip-stream');
const axios = require('axios');
const { extname } = require('path');
const { Sequelize, Model, DataTypes } = require('sequelize');
const index = require('fs').readFileSync('./index.html');

axios.defaults.validateStatus = function (status) {
  return status < 500; // Resolve only if the status code is less than 500
};

// const alt = fs
//   .readFileSync('./alt-source.txt', 'utf-8')
//   .split('\n')
//   .filter(Boolean)
//   .map((_) => parseInt(_, 10));

const sequelize = new Sequelize(
  process.env.DATABASE_URL || 'sqlite:zxdb.sqlite',
  {
    logging: false,
  }
);

const categoryLookup = {
  d: 'genretype_id between 71 and 79', // demos
  a: 'genretype_id between 42 and 68', // utilities (apps)
  g: 'genretype_id <=33', // games
  all: 'genretype_id < 200', // games
};

const machineTypeMap = new Map([
  [2, 4],
  [3, 4],
  [4, 4],
  [5, 1],
  [6, 0],
  [7, 1],
  [8, 'N'],
  [9, 'N'],
  [10, 1],
  [14, 'P'],
  [26, 'N'],
  [27, 'N'],
]);

const API = {
  v1: {
    find: findFile,
    get: getFile,
  },
  v2: {
    find: findFileV2,
    get: getFile,
  },
  test: {
    find: findFileV2,
    get: getFile,
  },
};

API.fallback = API['v1'];

http
  .createServer(function (req, res) {
    const parsed = url.parse(req.url, true);

    req.query = parsed.query;
    // req.query.encode = true;

    const paths = parsed.pathname.split('/').filter(Boolean);
    let version = 'fallback';
    let api = API.fallback;
    if (paths[0] && API[paths[0].toLowerCase()]) {
      version = paths.shift().toLowerCase();
      if (API[version]) {
        api = API[version];
      }
    }

    // reconstruct the URL
    req.pathname = paths.join('/');

    let method = paths.shift();

    if (method === 'get') {
      api.get(req, res).catch((e) => {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(e.message);
      });
    } else if (method) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('404: not found');
    } else {
      if (parsed.query.s) {
        api.find(req, res).catch((e) => {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end(e.message);
        });
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
    'select d.*, d.id as download_id, e.availabletype_id as availability from downloads d, entries e where d.id = ? and e.id=d.entry_id',
    {
      replacements: [id],
      type: sequelize.QueryTypes.SELECT,
    }
  );

  if (result.length !== 1 || result[0].availability !== 'A') {
    return res.end();
  }

  const { file_link } = result[0];
  const path = file_link.split('/').slice(3).join('/');

  const ext = path.split('.').slice(-2, -1)[0].toUpperCase();

  let { data: meta, status } = await axios.get(
    `${process.env.META_HOST}/${path}_CONTENTS/`
  );

  if (status !== 200) {
    // not found on FILE_HOST, since it's available - go elsewhere
    const direct = await tryDirect(result[0]);

    if (direct[0]) {
      const url = direct[0].url;

      const { data } = await axios({
        url,
        method: 'get',
        responseType: 'arraybuffer',
      });

      const filename = result[0].file_link.split('/').pop().replace(/.zip/, '');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.end(data);
    } else {
      res.end();
    }

    return;
  }

  meta = meta
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .filter((_) => _.name.toUpperCase().endsWith(ext));

  const url = `${process.env.FILE_HOST}/${path}_CONTENTS/${
    meta[subPart - 1].name
  }`;

  if (req.query.encode) {
    const { data } = await axios({
      url,
      method: 'get',
      responseType: 'arraybuffer',
    });

    res.end(Buffer.from(data).toString('base64'));
  } else {
    const { data } = await axios({
      url,
      responseType: 'stream',
      method: 'get',
    });

    res.setHeader('content-length', meta[subPart - 1].size);
    data.pipe(res);
  }
}

async function dbFindFile({ term, page = 0, cat = null }) {
  term = term.replace(/\*/g, ' ');
  page = parseInt(page);

  const offset = page * 10;

  return Array.from(
    await sequelize.query(
      `SELECT
          d.id AS download_id,
          e.id AS entity_id,
          e.title AS name,
          e.availabletype_id as availability,
          *
      FROM
        entries e,
        downloads d
      WHERE
        e.title LIKE :search_name
        AND e.id == d.entry_id
        AND d.filetype_id in(8, 10)
        AND ${categoryLookup[cat] || categoryLookup.all}
        OR
        e.title LIKE :search_name
        AND e.id == d.entry_id
        AND d.filetype_id in (8, 10)
        AND genretype_id IS NULL
      LIMIT ${offset},10`,
      {
        replacements: {
          search_name: term + '%',
        },
        type: sequelize.QueryTypes.SELECT,
      }
    )
  );
}

function getParams(req) {
  const term = req.query.s.replace(/\*/g, ' ');
  const page = parseInt(req.query.p || '0', 10);

  return {
    term,
    page,
  };
}

async function tryDirect(result) {
  if (result.availability !== 'A') {
    return [];
  }

  const { data, status } = await axios.get(
    `https://spectrumcomputing.co.uk/playonline.php?eml=1&downid=${result.download_id}`
  );

  if (status !== 200) {
    return [];
  }

  let line = data.split('\n').find((_) => _.includes('loadFile'));

  if (!line) {
    return [];
  }

  line = new Function(`return { ${line.trim()} }`)().loadFile;

  line = `https://spectrumcomputing.co.uk/${line}`;

  return [{ size: '?', url: line }];
}

async function getMetadata(results) {
  return Promise.all(
    results.map((_) => {
      const path = _.file_link.split('/').slice(3).join('/');
      const ext = path.split('.').slice(-2, -1)[0].toUpperCase();
      const zxdb = _.file_link.startsWith('/zxdb/');
      const host = zxdb ? process.env.ZXDB_HOST : process.env.META_HOST;
      const url = `${host}/${path}_CONTENTS/`;

      if (zxdb) return tryDirect(_);

      return axios
        .get(url)
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
}

async function findFileV2(req, res) {
  const { term, page } = getParams(req);
  const sorted = await dbFindFile({ term, page, cat: req.query.cat });
  const meta = await getMetadata(sorted);

  const str =
    sorted
      .map(
        (
          {
            entity_id,
            download_id,
            machinetype_id,
            title,
            file_link,
            release_year,
          },
          i
        ) => {
          if (!meta[i].length) return null;
          const machine = machineTypeMap.get(machinetype_id) || '?';
          return `^${download_id}^${title}^${file_link
            .split('/')
            .pop()
            .replace(/.zip/, '')}^${meta[i][0].size}^${meta[i].length}^${
            release_year || '?'
          }^${machine}^`;
        }
      )
      .filter((_) => _ !== null)
      .slice(0, 10)
      .join('\n') + '\n';

  res.setHeader('content-length', str.length);
  res.end(str);
}

async function findFile(req, res) {
  // let { data: ids } = await axios({
  //   url: 'https://api.zxinfo.dk/v3/search',
  //   headers: { 'user-agent': 'zxdb.remysharp.com' },
  //   params: {
  //     query: term,
  //     mode: 'tiny',
  //     size: 10,
  //     offset: 0,
  //     sort: 'rel_desc',
  //     output: 'simple',
  //     titlesonly: 'true',
  //     genretype: 'GAMES',
  //     contenttype: 'SOFTWARE',
  //   },
  // });

  // ids = ids.map((_) => parseInt(_.id, 10));
  // const result = await sequelize.query(
  //   'select d.id as download_id, e.id as entry_id, * from entries e, downloads d where e.id in (:ids) and e.id == d.entry_id and d.filetype_id in (8, 10)',
  //   {
  //     replacements: { ids },
  //     type: sequelize.QueryTypes.SELECT,
  //   }
  // );

  const { term } = getParams(req);
  const sorted = await dbFindFile({ term, cat: req.query.cat }).catch(
    (e) => {}
  );

  const meta = await getMetadata(sorted);

  const str =
    sorted
      .map(({ download_id, title, file_link, release_year }, i) => {
        // if (!meta[i].length) return null;
        let size = '?';

        let length = 0;
        if (meta[i].length) {
          length = meta[i].length;
          size = meta[i][0].size;
        }

        return `^${download_id}^${title}^${file_link
          .split('/')
          .pop()
          .replace(/.zip/, '')}^${size}^${length}^${release_year || '?'}^`;
      })
      .filter((_) => _ !== null)
      .slice(0, 10)
      .join('\n') + '\n';

  res.setHeader('content-length', str.length);
  res.end(str);
}
