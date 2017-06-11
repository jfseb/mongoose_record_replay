/*! copyright gerd forstmann, all rights reserved */
//var debug = require('debug')('appdata.nunit');
var process = require('process');
var root = (process.env.FSD_COVERAGE) ? '../gen_cov' : '../js';

//var fs = require('fs');

//var debuglog = require('debugf')('test.mongoose_record_replay.nunit.js');

var MongoMock = require(root + '/mgrecrep.js');

/**
 * clear a cache for the defaut mode for coverage
 */
/*
try {
  fs.unlinkSync('./node_modules/mgnlq_testmodel/testmodel/_cachefalse.js.zip');
} catch (e) {
  // empty
}

try {
  fs.unlinkSync('./testmodel/_cachetrue.js.zip');
} catch (e) {
  // empty
}
*/

exports.testDigestPlatformNeutral = function(test) {

  var res = MongoMock.digestArgs('abc','def', { a : /^abc/i, b : [1,2,'3'] } );
  test.equal(res, '896d5e71371a58f430b6bbe7fb9079b7');
  test.done();
};

exports.testDeser = function (test) {
  var ser = MongoMock.JSONStringify({ a: /abc/g, c: 1 });
  var r = MongoMock.JSONParse(ser);
  test.equal(r.a instanceof RegExp,true, 'object');
  //test.equal(typeof r.a, 'RegExp', 'object');
  test.equal(r.a.toString(), '/abc/g');
  test.done();
};

exports.testPlainMongo = function (test) {
  var mymock = {};
  var res = MongoMock.instrumentMongoose(mymock, 'path1', undefined);
  test.equal(res, mymock);
  test.done();
};

exports.testOpenConnection = function (test) {
  var mymock = {};
  test.expect(1);
  var res = MongoMock.instrumentMongoose(mymock, 'path1/', 'REPLAY');
  res.connect('dummyconn');
  res.connection.once('open', function () {
    test.equal(1, 1);
    test.done();
  });
};

exports.testOpenConnectionAndFind = function (test) {
  var mymock = {};
  test.expect(1);
  var mongooseM = MongoMock.instrumentMongoose(mymock, 'test/data/', 'REPLAY');
  mongooseM.connect('dummyconn');
  mongooseM.connection.once('open', function () {
    var model = mongooseM.model('abc', { a: 'schema' });
    model.find({}).lean().exec().then((res) => {

      test.deepEqual(res, [{ a: 1 }, { a: 2 }]);
      mongooseM.disconnect();
      test.done();
    });
  });
};



exports.testOpenConnectionAndFindNotPresent = function (test) {
  var mymock = {};
  test.expect(1);
  var mongooseM = MongoMock.instrumentMongoose(mymock, 'test/data/', 'REPLAY');
  mongooseM.connect('dummyconn');
  mongooseM.connection.once('open', function () {
    var model = mongooseM.model('abc', { a: 'schema' });
    try {
      model.find({ "a": 1 }).lean().exec().then((res) => {
        test.equal(1, 0);
        mongooseM.disconnect();
        test.done();
      });
    }
    catch (e) {
      test.equal(1, 1);
      mongooseM.disconnect();
      test.done();
    }
  });
};
