# mongoose_record_replay [![Build Status](https://travis-ci.org/jfseb/mongoose_record_replay.svg?branch=master)](https://travis-ci.org/jfseb/mgnlq_model)[![Coverage Status](https://coveralls.io/repos/github/jfseb/mgnlq_model/badge.svg)](https://coveralls.io/github/jfseb/mongoose_record_replay)
readonly mongoose drop in for testing ( and recording test data )

Allows to record query results,




#usage

```javascript
var mongoose = require('mongoose_record_replay').instrumentMongoose(require('mongoose'));
```


currently supported methods:

1. <Model>.find().lean().exec().then (...)#
2. <Model>.aggregate().then( ... )
3. <Model>.distinct( ).then( ... )


Environment variable
MONGO_RECORD_REPLAY controls the mode:

MONGO_RECORD_REPLAY   (not set) original mongoose
MONGO_RECORD_REPLAY=RECORD
MONGO_RECORD_REPLAY=REPLAY
On recording, files are created in



mongo_record_replay/
mongo_record_replay/data

The default folder can be changed via :

a) default mongo_record_replay/

a) Environment variable
MONGO_RECORD_REPLAY_FOLDER=mongo_record_replay/

b) explicit path as 2nd argument to
intrumentMongoose

>const recordFolder = './myfolder/';
>var mongoose = require('mongoose_record_replay').instrumentMongoose(require('mongoose'), recordFolder);
>
>
