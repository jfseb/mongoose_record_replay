# mongoose_record_replay [![Build Status](https://travis-ci.org/jfseb/mongoose_record_replay.svg?branch=master)](https://travis-ci.org/jfseb/mgnlq_model)[![Coverage Status](https://coveralls.io/repos/github/jfseb/mgnlq_model/badge.svg)](https://coveralls.io/github/jfseb/mongoose_record_replay)
readonly mongoose drop in for testing ( and recording test data )

Allows to record query results,




#usage

```javascript
var mongoose = require('mongoose_record_replay').instrumentMongoose(require('mongoose'));
```

##extended usage:
Behaviour can be set by environment variables ( see below) or explicitly via parameter:

```javascript
var mode = 'REPLAY';
if (process.env.MYSWITCH) {
  mode = 'RECORD';
}
var mongoose = require('mongoose_record_replay').instrumentMongoose(require('mongoose'),
  'node_modules/mgnlq_testmodel_replay/mgrecrep/',
  mode);
```
var mongoose = require('mongoose_record_replay').instrumentMongoose(require('mongoose'));
```



currently supported methods:

1. <Model>.find().lean().exec().then (...)#
2. <Model>.aggregate().then( ... )
3. <Model>.distinct( ).then( ... )


# Modes

The operational mode is controlled by the environment variable
``MONGO_RECORD_REPLAY``

## Original mongoose

## Replaying  (``set MONGO_RECORD_REPLAY=REPLAY``)

 Connection establishing is suppressed!

 operation <Model>.find, <Model>.aggregate, <Model>.distinct
 return there recorded result ( if found ) or an
 ENOENT message on the file

 (set debug=mongoose_rec* ) to get more information


## Recording  (``set MONGO_RECORD_REPLAY=RECORD``)

Queries are executed against mongoose,
1.  query input
    * ``<modelname>``,
    * `<operation> (e.g. `find, aggregate, distinct`),
    * `<query/pipeline>` arguments are recorded )
and
2. Result is recorded and stored.



## Recording location



On recording, files are created in (default location "mgrecrep/", can be controlled )

    1. mgrecrep/queries.json
        List of queries recorded
        could be used to refire them and update with new data.
        (=> nice feature)

    2. mgrecrep/data/<uniqueid>



The default folder can be changed via environment variables
``MONGO_RECORD_REPLAY_PATH``:

The variable value shall end with a terminating '/' !


    1. default mgrecrep
    2. Environment variable ``MONGO_RECORD_REPLAY_FOLDER``, e.g.
       ```
       process.env.MONGO_RECORD_REPLAY_FOLDER= mgrecrep/
       set MONGO_RECORD_REPLAY_FOLDER=mypath/myfolder/
       export MONGO_RECORD_REPLAY_FOLDER  mypath/myfolder/
       ```


    3. explicit path as 2nd argument to ``intrumentMongoose``

        ```javascript
        const recordFolder = './myfolder/';
        var mongoose = require('mongoose_record_replay').instrumentMongoose(require('mongoose'), recordFolder);
        ```



# Caveats / Known issues

 1. Beware: JSON serialization destroys differences between null and undefined etc.
 2. Currently returning full model documents is not supported,
    only the lean().exec promise chain

# Extends

feel free to record issue and provide pull request
