# ZXDB API for Spectrum Next

This is an extremely simple API service for use with the ZX Spectrum Next. If offers [ZXDB](https://spectrumcomputing.co.uk/) search and download functionality.

This service is intentionally non-SSL to allow for the ZX Spectrum Next to process the requests.

## API

All requests are `GET` based.

If processing on a Spectrum Next, you will need to pass the HTTP response headers, you can either wait for a blank line (as per HTTP specification to represent the start of the body) or `curl` and count the headers you need to skip. Current this code is hosted on Heroku so the headers shouldn't change in the foreseeable future - but this is not a given.

### GET /?s=SEARCHTERM

Searches for an entity based on a query using the [zxinfo search engine](https://api.zxinfo.dk/v3). Returns a maximum of 10 of encoded results.

**Note on spaces:** if the search term includes spaces, to reduce encoding requirements, spaces are represented with a `*` character. So _"manic miner"_ is `manic*miner`.

#### URL structure

`http://zxdb.remysharp.com/?s=target`

#### Example of result

```text
^25483^Target: Renegade^Target-Renegade.tzx^116696^2^1988^
^25485^Target: Renegade^Target-Renegade128.tap^112085^1^1988^
^25486^Target: Renegade^Target-Renegade48.tap^107007^1^1988^
^25487^Target: Renegade^Target-Renegade(ErbeSoftwareS.A.).tzx^112472^2^1988^
^25489^Target: Renegade^Target-Renegade(TheHitSquad).tzx^116696^1^1990^
^25459^Renegade^Renegade.tzx^67665^2^1987^
^25461^Renegade^Renegade128.tap^71429^1^1987^
^25462^Renegade^Renegade48.tap^48977^1^1987^
^25463^Renegade^Renegade(ErbeSoftwareS.A.).tzx^59640^2^1987^
^25465^Renegade^Renegade(TheHitSquad).tzx^62903^2^1989^
```

#### Data structure explained

The fields are separated by the `^` character and rows are terminated by `\n`

The fields are:

1.  Download id
2.  Title
3.  Filename and type (TAP, TZX, etc)
4.  File size
5.  Number of file options (default: 1)
6.  Year published

The `id` is **required** to download a file.

In the case where the number of file options (field 5) to request file 2, append `/2` to the `/get/<id>/2` request.

#### Categories

By default all types of records are returned. You can narrow the results with a query string `?cat=n`, where `n` is short for:

*   `g` - games only
*   `a` - apps and utilities
*   `d` - demos including music

If a category short code isn't recognised, the filtering is disabled.

### GET /get/ID

Returns a binary stream with `content-length` header set for the given file `id`. The file format will be the type associated with the particular ID.

#### URL structure

```
http://zxdb.remysharp.com/get/18840
```

## Maintenance

1. Download the [zxdb project](https://github.com/zxdb/ZXDB)
2. In that project directory, run `$ python3 scripts/ZXDB_to_SQLite.py`
3. Then create the database: `$ cat ZXDB_sqlite.sql| sqlite3 zxdb.sqlite`
4. Remove the unneeded/unwanted tables: `$ sqllite3 zxdb.sqlite` then run the following lines:

```sql
PRAGMA writable_schema = 1;
DELETE FROM sqlite_master WHERE type = 'table' AND name NOT IN ('downloads', 'entries');
PRAGMA writable_schema = 0;
VACUUM;
```

5. Copy across `zxdb.sqlite` into this project.

## License

- [MIT](https://rem.mit-license.org/)
